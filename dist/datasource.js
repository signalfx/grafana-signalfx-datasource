'use strict';

System.register(['lodash', './signalfx', './stream_handler'], function (_export, _context) {
  "use strict";

  var _, signalfx, StreamHandler, _createClass, SignalFxDatasource;

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  return {
    setters: [function (_lodash) {
      _ = _lodash.default;
    }, function (_signalfx) {
      signalfx = _signalfx.default;
    }, function (_stream_handler) {
      StreamHandler = _stream_handler.StreamHandler;
    }],
    execute: function () {
      _createClass = function () {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ("value" in descriptor) descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
          }
        }

        return function (Constructor, protoProps, staticProps) {
          if (protoProps) defineProperties(Constructor.prototype, protoProps);
          if (staticProps) defineProperties(Constructor, staticProps);
          return Constructor;
        };
      }();

      _export('SignalFxDatasource', SignalFxDatasource = function () {
        function SignalFxDatasource(instanceSettings, $q, backendSrv, templateSrv) {
          _classCallCheck(this, SignalFxDatasource);

          this.type = instanceSettings.type;
          this.url = instanceSettings.url;
          this.name = instanceSettings.name;
          this.q = $q;
          this.backendSrv = backendSrv;
          this.templateSrv = templateSrv;
          this.withCredentials = instanceSettings.withCredentials;
          this.authToken = instanceSettings.jsonData.accessToken;
          this.headers = { 'Content-Type': 'application/json' };
          this.headers['X-SF-TOKEN'] = this.authToken;
          this.endpoint = instanceSettings.url.replace(/^(http)(s)?:/, function (match, p1, p2) {
            return 'ws' + (p2 || '') + ':';
          });
          console.log('Using SignalFx at ' + this.endpoint);
          this.signalflow = window.signalfx.streamer.SignalFlow(this.authToken, {
            signalflowEndpoint: this.endpoint
          });
          this.streams = [];
          // give interpolateQueryStr access to this
          this.interpolateQueryStr = this.interpolateQueryStr.bind(this);
        }

        _createClass(SignalFxDatasource, [{
          key: 'query',
          value: function query(options) {
            var _this = this;

            var queries = _.filter(options.targets, function (t) {
              return t.hide !== true;
            }).map(function (t) {
              return _this.templateSrv.replace(t.program, options.scopedVars, _this.interpolateQueryStr);
            });
            var program = queries.join('\n');

            var aliases = this.collectAliases(options);

            // TODO: Better validation can be implemented here 
            if (!program) {
              return Promise.resolve({ data: [] });
            }

            var handler = this.streams[options.panelId];
            if (!handler) {
              handler = new StreamHandler(this.signalflow, this.templateSrv);
              this.streams[options.panelId] = handler;
            }
            return handler.start(program, aliases, options);
          }
        }, {
          key: 'collectAliases',
          value: function collectAliases(options) {
            var _this2 = this;

            return _.fromPairs(_.filter(options.targets, function (t) {
              return t.hide !== true && t.program && t.alias;
            }).map(function (t) {
              return { program: _this2.templateSrv.replace(t.program, options.scopedVars || {}, _this2.interpolateQueryStr), alias: t.alias };
            }).flatMap(function (t) {
              return _this2.extractLabelsWithAlias(t.program, t.alias);
            }));
          }
        }, {
          key: 'extractLabelsWithAlias',
          value: function extractLabelsWithAlias(program, alias) {
            var re = /label\s?=\s?'([\w]*?)'/igm;
            var labels = [];
            var m;
            do {
              m = re.exec(program);
              if (m) {
                labels.push([m[1], alias]);
              }
            } while (m);
            return labels;
          }
        }, {
          key: 'testDatasource',
          value: function testDatasource() {
            return this.doRequest({
              url: this.url + '/v2/metric',
              method: 'GET'
            }).then(function (response) {
              if (response.status === 200) {
                return { status: "success", message: "Data source is working", title: "Success" };
              }
            });
          }
        }, {
          key: 'metricFindQuery',
          value: function metricFindQuery(query) {
            var metricNameQuery = query.match(/^metrics\(([^\)]*?)\)/);
            if (metricNameQuery) {
              return this.getMetrics(this.templateSrv.replace(metricNameQuery[1]));
            }
            var propertyKeysQuery = query.match(/^property_keys\(([^\)]+?)(,\s?([^,]+?))?\)/);
            if (propertyKeysQuery) {
              return this.getPropertyKeys(this.templateSrv.replace(propertyKeysQuery[1]), this.templateSrv.replace(propertyKeysQuery[3]));
            }
            var propertyValuesQuery = query.match(/^property_values\(([^,]+?),\s?([^,]+?)(,\s?(.+))?\)/);
            if (propertyValuesQuery) {
              return this.getPropertyValues(this.templateSrv.replace(propertyValuesQuery[1]), this.templateSrv.replace(propertyValuesQuery[2]), this.templateSrv.replace(propertyValuesQuery[4]));
            }
            var tagsQuery = query.match(/^tags\(([^\)]+?)(,\s?([^,]+?))?\)/);
            if (tagsQuery) {
              return this.getTags(this.templateSrv.replace(tagsQuery[1]), this.templateSrv.replace(tagsQuery[3]));
            }
            // var globalTagsQuery = query.match(/^tags\(([^\)]*?)\)/);
            // if (globalTagsQuery) {
            //   return this.getGlobalTags(this.templateSrv.replace(globalTagsQuery[1]));
            // }
            this.q.when([]);
          }
        }, {
          key: 'getMetrics',
          value: function getMetrics(query) {
            return this.doQueryRequest('/v2/metric', 'name:' + (query ? query : '*')).then(this.mapMetricsToTextValue);
          }
        }, {
          key: 'mapMetricsToTextValue',
          value: function mapMetricsToTextValue(result) {
            return _.map(result.data.results, function (d) {
              return { text: d.name, value: d.name };
            });
          }
        }, {
          key: 'getPropertyKeys',
          value: function getPropertyKeys(metric, partialInput) {
            return this.doSuggestQueryRequest(metric, null, partialInput).then(this.mapPropertiesToTextValue);
          }
        }, {
          key: 'getPropertyValues',
          value: function getPropertyValues(metric, propertyKey, partialInput) {
            return this.doSuggestQueryRequest(metric, propertyKey, partialInput).then(this.mapPropertiesToTextValue);
          }
        }, {
          key: 'getTags',
          value: function getTags(metric, partialInput) {
            return this.doSuggestQueryRequest(metric, 'sf_tags', partialInput).then(this.mapPropertiesToTextValue);
          }
        }, {
          key: 'mapPropertiesToTextValue',
          value: function mapPropertiesToTextValue(result) {
            return _.map(result.data, function (d) {
              return { text: d, value: d };
            });
          }
        }, {
          key: 'doQueryRequest',
          value: function doQueryRequest(path, query) {
            return this.doRequest({
              url: this.url + path,
              params: { query: this.escapeQuery(query), limit: 100 },
              method: 'GET'
            });
          }
        }, {
          key: 'doSuggestQueryRequest',
          value: function doSuggestQueryRequest(metric, property, partialInput) {
            var program = {
              programText: 'data(\'' + metric + '\').publish(label=\'A\')',
              packageSpecifications: ''
            };
            var request = {
              programs: [program],
              property: property,
              partialInput: partialInput != null ? partialInput : '',
              limit: 100,
              additionalFilters: [],
              additionalReplaceOnlyFilters: [],
              additionalQuery: null
            };
            return this.doRequest({
              url: this.url + '/v2/suggest/_signalflowsuggest',
              data: JSON.stringify(request),
              method: 'POST'
            });
          }
        }, {
          key: 'escapeQuery',
          value: function escapeQuery(query) {
            return query.replace(/[\/]/g, '\\$&');
          }
        }, {
          key: 'doRequest',
          value: function doRequest(options) {
            options.headers = this.headers;
            return this.backendSrv.datasourceRequest(options);
          }
        }, {
          key: 'interpolateQueryStr',
          value: function interpolateQueryStr(value, variable, defaultFormatFn) {
            // if no multi or include all do not regexEscape
            if (!variable.multi && !variable.includeAll) {
              return this.escapeLiteral(value);
            }

            if (typeof value === 'string') {
              return this.quoteLiteral(value);
            }

            var escapedValues = _.map(value, this.quoteLiteral);
            return escapedValues.join(',');
          }
        }, {
          key: 'quoteLiteral',
          value: function quoteLiteral(value) {
            return "'" + String(value).replace(/'/g, "''") + "'";
          }
        }, {
          key: 'escapeLiteral',
          value: function escapeLiteral(value) {
            return String(value).replace(/'/g, "''");
          }
        }]);

        return SignalFxDatasource;
      }());

      _export('SignalFxDatasource', SignalFxDatasource);
    }
  };
});
//# sourceMappingURL=datasource.js.map
