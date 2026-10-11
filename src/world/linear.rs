//! Linear's GraphQL API, called as `main`'s LinearSource called it.

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use super::{
    HttpRequest, LinearBlocker, LinearIssue, LinearProject, LinearTeam, Named, Nodes, Page,
    PageInfo, READY_LABEL, RealWorld, World, WorldError, WorldResult, invalid,
};

const ENDPOINT: &str = "https://api.linear.app/graphql";

const ISSUES_QUERY: &str = "query($filter: IssueFilter!, $cursor: String) {
  issues(first: 100, after: $cursor, filter: $filter) {
    nodes {
      id identifier title url branchName createdAt team { id key name } project { id name }
      state { type } assignee { id }
      labels(first: 100) { nodes { name } pageInfo { hasNextPage endCursor } }
      inverseRelations(first: 100) { nodes { type issue { identifier state { type } } } pageInfo { hasNextPage endCursor } }
      parent { identifier } children(first: 1) { nodes { id } }
    }
    pageInfo { hasNextPage endCursor }
  }
}";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueNode {
    id: String,
    identifier: String,
    title: String,
    url: String,
    branch_name: String,
    created_at: String,
    team: LinearTeam,
    project: Option<LinearProject>,
    state: StateNode,
    assignee: Option<IdNode>,
    labels: Page<Named>,
    inverse_relations: Page<RelationNode>,
    parent: Option<RelatedNode>,
    children: Nodes<IdNode>,
}

#[derive(Deserialize)]
struct StateNode {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
struct IdNode {
    id: String,
}

#[derive(Deserialize)]
struct RelationNode {
    #[serde(rename = "type")]
    kind: String,
    issue: RelatedNode,
}

#[derive(Deserialize)]
struct RelatedNode {
    identifier: String,
    state: Option<StateNode>,
}

#[derive(Deserialize)]
struct UrlNode {
    url: String,
}

/// The id of the API key's owner: the user.
pub(super) fn viewer(world: &RealWorld) -> WorldResult<String> {
    let data: Value = query(world, "query { viewer { id } }", json!({}))?;
    data["viewer"]["id"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| invalid("Linear"))
}

/// The team's `ready-for-agent` issues; `team` is its id, key or name.
pub(super) fn issues(world: &RealWorld, team: &str) -> WorldResult<Vec<LinearIssue>> {
    let team_filter = if is_uuid(team) {
        json!({ "id": { "eq": team } })
    } else {
        json!({ "or": [{ "key": { "eq": team } }, { "name": { "eq": team } }] })
    };
    let filter = json!({ "team": team_filter, "labels": { "name": { "eq": READY_LABEL } } });
    let mut issues = vec![];
    let mut cursor: Option<String> = None;
    loop {
        let data: Value = query(
            world,
            ISSUES_QUERY,
            json!({ "filter": filter, "cursor": cursor }),
        )?;
        let page: Page<IssueNode> = from(&data["issues"])?;
        for node in page.nodes {
            issues.push(to_issue(world, node)?);
        }
        cursor = next_cursor(&page.page_info)?;
        if cursor.is_none() {
            return Ok(issues);
        }
    }
}

pub(super) fn attachment_urls(world: &RealWorld, identifier: &str) -> WorldResult<Vec<String>> {
    let text = "query($id: String!) { issue(id: $id) { id attachments(first: 100) { nodes { url } pageInfo { hasNextPage endCursor } } } }";
    let data: Value = query(world, text, json!({ "id": identifier }))?;
    let id: String = from(&data["issue"]["id"])?;
    let first: Page<UrlNode> = from(&data["issue"]["attachments"])?;
    let attachments = remaining(world, &id, "attachments", first, "url")?;
    Ok(attachments.into_iter().map(|a| a.url).collect())
}

fn to_issue(world: &RealWorld, node: IssueNode) -> WorldResult<LinearIssue> {
    let labels = remaining(world, &node.id, "labels", node.labels, "name")?;
    let relations = remaining(
        world,
        &node.id,
        "inverseRelations",
        node.inverse_relations,
        "type issue { identifier state { type } }",
    )?;
    Ok(LinearIssue {
        identifier: node.identifier,
        title: node.title,
        url: node.url,
        branch_name: node.branch_name,
        created_at: node.created_at,
        team: node.team,
        project: node.project,
        labels: labels.into_iter().map(|l| l.name).collect(),
        state: node.state.kind,
        assignee: node.assignee.map(|a| a.id),
        // An inverse `blocks` relation of X is "Y blocks X": Y is X's Blocker.
        blockers: relations
            .into_iter()
            .filter(|r| r.kind == "blocks")
            .map(|r| LinearBlocker {
                identifier: r.issue.identifier,
                state: r.issue.state.map(|s| s.kind).unwrap_or_default(),
            })
            .collect(),
        parent: node.parent.map(|p| p.identifier),
        has_sub_issues: !node.children.nodes.is_empty(),
    })
}

/// `first`'s nodes, then those of each page after it of the issue's `field`.
fn remaining<T: DeserializeOwned>(
    world: &RealWorld,
    id: &str,
    field: &str,
    first: Page<T>,
    fields: &str,
) -> WorldResult<Vec<T>> {
    let mut nodes = first.nodes;
    let mut cursor = next_cursor(&first.page_info)?;
    while let Some(after) = cursor {
        let text = format!(
            "query($id: String!, $cursor: String) {{ issue(id: $id) {{ {field}(first: 100, after: $cursor) {{ nodes {{ {fields} }} pageInfo {{ hasNextPage endCursor }} }} }} }}"
        );
        let data: Value = query(world, &text, json!({ "id": id, "cursor": after }))?;
        let page: Page<T> = from(&data["issue"][field])?;
        nodes.extend(page.nodes);
        cursor = next_cursor(&page.page_info)?;
    }
    Ok(nodes)
}

fn next_cursor(page: &PageInfo) -> WorldResult<Option<String>> {
    match page {
        PageInfo {
            has_next_page: false,
            ..
        } => Ok(None),
        PageInfo {
            end_cursor: Some(cursor),
            ..
        } => Ok(Some(cursor.clone())),
        _ => Err(WorldError("Linear returned a page without a cursor".into())),
    }
}

fn from<T: DeserializeOwned>(value: &Value) -> WorldResult<T> {
    T::deserialize(value).map_err(|_| invalid("Linear"))
}

/// The `data` of a GraphQL request, or why there is none.
fn query<T: DeserializeOwned>(world: &RealWorld, text: &str, variables: Value) -> WorldResult<T> {
    let request = HttpRequest {
        method: "POST".into(),
        url: ENDPOINT.into(),
        headers: vec![
            ("Content-Type".into(), "application/json".into()),
            // A personal API key goes as is, without `Bearer`.
            ("Authorization".into(), key(&world.config_dir)?),
        ],
        body: json!({ "query": text, "variables": variables }).to_string(),
    };
    let response = world
        .http(&request)
        .map_err(|_| WorldError("Linear request failed; check your network".into()))?;
    match response.status {
        200..=299 => {}
        401 | 403 => {
            return Err(WorldError(
                "Not authenticated with Linear; check LINEAR_API_KEY".into(),
            ));
        }
        status => return Err(WorldError(format!("Linear request failed (HTTP {status})"))),
    }
    let payload: Value = serde_json::from_str(&response.body).map_err(|_| invalid("Linear"))?;
    if payload["errors"].as_array().is_some_and(|e| !e.is_empty()) || payload["data"].is_null() {
        return Err(WorldError(
            "Linear GraphQL request failed; check API key permissions and selectors".into(),
        ));
    }
    from(&payload["data"])
}

/// `LINEAR_API_KEY` from the environment, else from `secrets.env` in the
/// config directory, which only its owner may read.
fn key(config_dir: &Path) -> WorldResult<String> {
    if let Some(key) = std::env::var("LINEAR_API_KEY")
        .ok()
        .filter(|k| !k.is_empty())
    {
        return Ok(key);
    }
    let missing = || {
        WorldError(
            "Missing LINEAR_API_KEY; set it in the environment or secrets.env with mode 600".into(),
        )
    };
    let unreadable = || WorldError("Could not read Linear secrets.env".into());
    let file = config_dir.join("secrets.env");
    let mode = match fs::metadata(&file) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Err(missing()),
        meta => meta.map_err(|_| unreadable())?.permissions().mode(),
    };
    if mode & 0o777 != 0o600 {
        return Err(WorldError(format!("{} must have mode 600", file.display())));
    }
    let text = fs::read_to_string(&file).map_err(|_| unreadable())?;
    let value = text.lines().find_map(|line| {
        let line = line.trim();
        let line = line.strip_prefix("export ").map_or(line, str::trim_start);
        line.strip_prefix("LINEAR_API_KEY")?
            .trim_start()
            .strip_prefix('=')
    });
    let value = value.map(str::trim).unwrap_or_default();
    let unquoted = ['"', '\'']
        .iter()
        .find_map(|q| value.strip_prefix(*q)?.strip_suffix(*q))
        .unwrap_or(value);
    if unquoted.is_empty() {
        return Err(missing());
    }
    Ok(unquoted.into())
}

fn is_uuid(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    parts.iter().map(|p| p.len()).eq([8, 4, 4, 4, 12])
        && parts
            .iter()
            .all(|p| p.chars().all(|c| c.is_ascii_hexdigit()))
}
