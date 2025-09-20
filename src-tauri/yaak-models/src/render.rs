use crate::models::{Environment, EnvironmentVariable};
use std::collections::HashMap;

pub fn make_vars_hashmap(environment_chain: Vec<Environment>) -> HashMap<String, String> {
    let mut variables = HashMap::new();

    for e in environment_chain.iter().rev() {
        variables = add_variable_to_map(variables, &e.variables);
    }

    variables
}

fn add_variable_to_map(
    m: HashMap<String, String>,
    variables: &Vec<EnvironmentVariable>,
) -> HashMap<String, String> {
    let mut map = m.clone();
    for variable in variables {
        if !variable.enabled || variable.value.is_empty() {
            continue;
        }
        let name = variable.name.as_str();
        let value = variable.value.as_str();
        map.insert(name.into(), value.into());
    }

    map
}
