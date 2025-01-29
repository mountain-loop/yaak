use std::collections::HashMap;
use crate::models::{Environment, EnvironmentVariable};

pub fn make_vars_hashmap(
    base_environment: &Environment,
    environment: Option<&Environment>,
) -> HashMap<String, String> {
    let mut variables = HashMap::new();
    variables = add_variable_to_map(variables, &base_environment.variables);

    if let Some(e) = environment {
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

