//! `ask`: a question about a Wiki, answered by the wiki model from only the
//! records of the Wiki closest to it, each a Component's overview or an
//! Interpretation, found by their embeddings from Ollama. The embeddings are
//! kept in the config directory, beside the Wiki's build, and made again
//! when missing.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::cli::{Context, Refusal};
use crate::config::{Config, fill_in};
use crate::state;
use crate::wiki::{self, Anchor, Of};
use crate::world::Headless;

/// The embeddings of a Wiki's records, in its folder in the config directory.
const VECTORS: &str = "vectors.json";

/// How many records an answer is made from.
const CLOSEST: usize = 8;

/// What `ask` answers while Ollama does not.
const UNAVAILABLE: &str = "search unavailable, use find_component";

const PROMPT: &str = r#"You answer a question about the code of {repo} from what its Wiki says, and from nothing else: the records below, each a Component's overview or a claim with the lines of code it cites. You have no tools.

## The question

{question}

## What the Wiki says

{records}## How to answer

Answer in at most 5 sentences. Each sentence cites at least one Anchor of a claim above that shows it, copied exactly as written there; leave out any sentence no Anchor shows. When nothing above answers the question, answer with no sentences.

Answer with one JSON object and nothing else:

{"sentences": [{"text": "...", "anchors": [{"path": "...", "start": 1, "end": 2}]}]}
"#;

impl Anchor {
    /// Whether `self` cites lines, and only lines `other` does.
    fn within(&self, other: &Anchor) -> bool {
        let lines = other.start <= self.start && self.start <= self.end && self.end <= other.end;
        self.path == other.path && lines
    }
}

/// A sentence of the wiki model's answer.
#[derive(Serialize, Deserialize)]
struct Sentence {
    text: String,
    anchors: Vec<Anchor>,
}

/// The embeddings of a Wiki's records, by their text, as `model` made them.
#[derive(Default, Serialize, Deserialize)]
struct Vectors {
    model: String,
    vectors: BTreeMap<String, Vec<f32>>,
}

/// A Component's overview, or one of its Interpretations.
pub struct Record<'a> {
    component: &'a Value,
    interpretation: Option<&'a Value>,
}

impl Record<'_> {
    fn text(&self) -> &str {
        let said = (self.interpretation).map_or(&self.component["overview"], |i| &i["text"]);
        said.as_str().unwrap_or_default()
    }

    /// The Anchors it cites: none for an overview.
    fn anchors(&self) -> Vec<Anchor> {
        let anchors = self.interpretation.map(|i| i["anchors"].clone());
        serde_json::from_value(anchors.unwrap_or_default()).unwrap_or_default()
    }
}

/// Every record of `wiki` that says something, a Component's overview
/// before its Interpretations.
fn records(wiki: &Value) -> Vec<Record<'_>> {
    let components = wiki["components"].as_array().map_or(&[][..], Vec::as_slice);
    (components.iter())
        .flat_map(|component| {
            let interpretations = component["interpretations"].as_array().into_iter();
            let overview = Record {
                component,
                interpretation: None,
            };
            std::iter::once(overview).chain(interpretations.flatten().map(|i| Record {
                component,
                interpretation: Some(i),
            }))
        })
        .filter(|record| !record.text().is_empty())
        .collect()
}

/// Each record of `wiki`, the Wiki kept in the folder `folder`, with its
/// embedding: those the config directory lacks embedded through Ollama now,
/// and kept there.
pub fn embedded<'a>(
    ctx: &Context,
    config: &Config,
    folder: &str,
    wiki: &'a Value,
) -> Result<Vec<(Record<'a>, Vec<f32>)>, Refusal> {
    let (records, model) = (records(wiki), &config.wiki.embed_model);
    let file = ctx.config_dir.join("wiki").join(folder).join(VECTORS);
    // Under its lock: two asks at once embed a Wiki once.
    let vectors = state::update(&file, |text| {
        // One that does not read is made again, as a missing one is.
        let mut kept: Vectors = state::parse(&file, text).unwrap_or_default();
        if kept.model != *model {
            kept = Vectors {
                model: model.clone(),
                vectors: BTreeMap::new(),
            };
        }
        let mut seen = HashSet::new();
        let missing: Vec<String> = (records.iter())
            .map(Record::text)
            .filter(|text| !kept.vectors.contains_key(*text) && seen.insert(*text))
            .map(String::from)
            .collect();
        // A few a request: its body is one argument of `curl`, which must answer in 30 s.
        for missing in missing.chunks(64) {
            let embedded = (ctx.world).ollama_embed(&config.wiki.ollama, model, missing)?;
            kept.vectors.extend(missing.iter().cloned().zip(embedded));
        }
        let texts: HashSet<&str> = records.iter().map(Record::text).collect();
        kept.vectors.retain(|text, _| texts.contains(text.as_str()));
        Ok::<_, Refusal>((state::text(&kept), kept.vectors))
    })?;
    Ok((records.into_iter())
        .filter_map(|record| {
            let vector = vectors.get(record.text())?.clone();
            Some((record, vector))
        })
        .collect())
}

/// What `ask` answers `question` with from `wiki`, the Wiki `of`: the
/// sentences of the wiki model's answer that cite only Anchors of the
/// records closest to the question, and the Interpretations they cite.
pub fn ask(
    ctx: &Context,
    config: &Config,
    of: &Of,
    wiki: &Value,
    question: &str,
) -> Result<Value, String> {
    let (world, id, clone) = (ctx.world, &of.id(), &of.clone_dir(&ctx.config_dir));
    let records = embedded(ctx, config, &of.folder(), wiki).map_err(|_| UNAVAILABLE.to_string())?;
    let (ollama, model) = (&config.wiki.ollama, &config.wiki.embed_model);
    let asked = (world.ollama_embed(ollama, model, &[question.into()]).ok())
        .and_then(|mut asked| asked.pop())
        .ok_or(UNAVAILABLE)?;
    let mut closest: Vec<(f32, Record)> = (records.into_iter())
        .map(|(record, vector)| (cosine(&asked, &vector), record))
        .collect();
    // Stable: a tie keeps the Wiki's order.
    closest.sort_by(|a, b| b.0.total_cmp(&a.0));
    let closest: Vec<Record> = (closest.into_iter().take(CLOSEST))
        .map(|(_, record)| record)
        .collect();
    let commit = wiki["commit"].as_str().unwrap_or_default();
    let mut files: HashMap<String, String> = HashMap::new();
    let mut shown = String::new();
    for record in &closest {
        let name = record.component["name"].as_str().unwrap_or_default();
        let Some(interpretation) = record.interpretation else {
            shown += &format!("### The overview of {name}\n\n{}\n\n", record.text());
            continue;
        };
        let kind = interpretation["kind"].as_str().unwrap_or_default();
        shown += &format!("### A claim of {name}: {kind}\n\n{}\n\n", record.text());
        for anchor in record.anchors() {
            if !files.contains_key(&anchor.path) {
                let held = world
                    .git_show(clone, commit, &anchor.path)
                    .map_err(|e| e.0)?;
                files.insert(anchor.path.clone(), held.unwrap_or_default());
            }
            let lines: String = (files[&anchor.path].lines().enumerate())
                .skip(anchor.start.saturating_sub(1))
                .take((anchor.end + 1).saturating_sub(anchor.start))
                .map(|(n, line)| format!("{}: {line}\n", n + 1))
                .collect();
            let (path, start, end) = (json!(anchor.path), anchor.start, anchor.end);
            shown += &format!(
                "{{\"path\": {path}, \"start\": {start}, \"end\": {end}}}\n\n```\n{lines}```\n\n"
            );
        }
    }
    // The records last: code they quote is never taken for a placeholder.
    let values = [
        ("repo", id.as_str()),
        ("question", question),
        ("records", &shown),
    ];
    let call = Headless {
        prompt: fill_in(PROMPT, &values),
        ..wiki::headless(config, &["*"]).map_err(|no| no.error)?
    };
    let dir = ctx.config_dir.display().to_string();
    let answer = (world.harness_headless(&dir, &[call], 1).pop())
        .expect("an answer to the call")
        .map_err(|e| e.0)?
        .text;
    let sentences = parsed(&answer).ok_or_else(|| {
        format!("the wiki model's answer does not read, so use find_component: {answer}")
    })?;
    let retrieved: Vec<Anchor> = closest.iter().flat_map(Record::anchors).collect();
    let answer: Vec<Sentence> = (sentences.into_iter())
        .filter_map(|sentence| serde_json::from_value::<Sentence>(sentence).ok())
        .filter(|sentence| {
            !sentence.text.trim().is_empty()
                && !sentence.anchors.is_empty()
                && (sentence.anchors.iter()).all(|a| retrieved.iter().any(|r| a.within(r)))
        })
        .collect();
    let cited = |record: &Record| {
        let anchors = record.anchors();
        (answer.iter().flat_map(|s| &s.anchors)).any(|a| anchors.iter().any(|r| a.within(r)))
    };
    let records: Vec<Value> = (closest.iter().filter(|record| cited(record)))
        .filter_map(|record| {
            let mut interpretation = record.interpretation?.clone();
            interpretation["component"] = record.component["id"].clone();
            Some(interpretation)
        })
        .collect();
    Ok(json!({ "answer": answer, "records": records }))
}

/// The sentences of the answer in `text`, its one JSON object, fenced or not.
fn parsed(text: &str) -> Option<Vec<Value>> {
    let (start, end) = (text.find('{')?, text.rfind('}')?);
    let answer: Value = serde_json::from_str(text.get(start..=end)?).ok()?;
    answer["sentences"].as_array().cloned()
}

/// How alike `a` and `b` point: 1 the same way, 0 across, -1 opposite.
fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt();
    // An empty vector points nowhere: 0, never NaN.
    dot / (norm(a) * norm(b)).max(f32::MIN_POSITIVE)
}
