# SignalFX Grafana Datasource Plugin

## Adding the data source to Grafana

Click the Settings tab in the Data Sources dialog box to setup the Grafana plugin as shown below.

![Configuration](./docs/config.png "Configuration")

| Name	         | Description |
|----------------|-------------|
| _Name_         | The data source name reference in panels & queries. |
| _Default_      | Default data source means that it will be pre-selected for new panels. |
| _Endpoint_	     | The URL of the SignalFlow API endpoint. |
| _Access Token_ | SignalFx API access token. |


## Metric Query Editor

![Query Editor](./docs/query_editor.png "Query Editor")

### Alias Patterns
* $label = The label used in the SignalFlow program.
* $metric = The metric name.
* $somename = The value of the ``somename`` property or dimension.
* You can also use [[somename]] pattern replacement syntax.

Example:
```
$label $application_name [[port]]
```

## Templating

Use template variables rather than hard-coding server, application, and sensor names in your metric queries. Variables are shown as dropdown select boxes at the top of the dashboard. These dropdowns makes it easy to change the data being displayed in your dashboard.

Check out the [Templating documentation](https://grafana.com/docs/reference/templating/) for an introduction to the templating feature and the different types of template variables.

### Query Variables

Query variables let you query SignalFx for a list of metrics, tags, property keys or property values. 
SignalFx Datasource Plugin provides the following functions you can use in the Query input field of the Variable edit view.

| Name                                           | Description                                                          |
|------------------------------------------------|----------------------------------------------------------------------|
|    _metrics(filter)_                             | Lists metrics based on name pattern, e.g. ``metrics(instance/disk/*)``.      |
|    _property\_keys(metric,[filter])_           | Lists property keys based on metric name and optional filter, e.g. ``property_keys($var_consul_metric,con)``. |
|    _property\_values(metric,property,[filter])_| Lists property values based on metric name, property name, and optional filter, e.g. ``property_values($var_consul_metric, $var_consul_property)``. |
|    _tags(metric,[filter])_                              | Lists tags matching the specified pattern, e.g. ``tags(*cpu*,kafka)``. |

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
