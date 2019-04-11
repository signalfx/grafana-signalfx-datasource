# SignalFX Grafana Datasource Plugin

## Adding the data source to Grafana

![Configuration](./docs/config.png "Configuration")

| Name	         | Description |
|----------------|-------------|
| _Name_         | The data source name. This is how you refer to the data source in panels & queries. |
| _Default_      | Default data source means that it will be pre-selected for new panels. |
| _Endpoint_	     | The URL of the SignalFlow API endpoint. |
| _Access Token_ | SignalFx API access token. |


## Metric Query Editor

![Query Editor](./docs/query_editor.png "Query Editor")

### Alias Patterns
* $label = replaced with label used in SignalFlow program
* $metric = replaced with metric name
* $somename = replaces with value of the ``somename`` property or dimension.
* You can also use [[somename]] pattern replacement syntax.

Examples:
```
$label $application_name [[port]]
```

## Templating

Instead of hard-coding things like server, application and sensor name in you metric queries you can use variables in their place. Variables are shown as dropdown select boxes at the top of the dashboard. These dropdowns makes it easy to change the data being displayed in your dashboard.

Checkout the [Templating](https://grafana.com/docs/reference/templating/) documentation for an introduction to the templating feature and the different types of template variables.

### Query Variables

Variable of the type Query allows you to query SignalFx for a list of metrics, tags, property keys or property values. 
SignalFx Datasource Plugin provides the following functions you can use in the Query input field in the Variable edit view.

| Name                                           | Description                                                          |
|------------------------------------------------|----------------------------------------------------------------------|
|    _metrics(filter)_                             | List metrics based on name pattern, e.g. ``metrics(instance/disk/*)``.      |
|    _property\_keys(metric,[filter])_           | List property keys based on metric name and optional filter, e.g. ``property_keys($var_consul_metric,con)``. |
|    _property\_values(metric,property,[filter])_| List property values basen on metric name, property name and optional filter, e.g. ``property_values($var_consul_metric, $var_consul_property)``. |
|    _tags(metric,[filter])_                              | List tags matching the given pattern, e.g. ``tags(*cpu*,kafka)``. |

### Using Variables in Queries

Examples:
```
A = data('[[var_consul_metric]]', filter=filter('[[var_consul_property]]', '[[var_consul_prop_value]]')).publish(label='A')
```

```
A = data('Latency', filter=filter('stat', 'mean'), rollup='latest').$aggregation().publish(label='A')
```
## Installation

Copy the ``dist`` directory into your grafana plugins directory, e.g. /var/lib/grafana/plugins/signalfx-datasource.