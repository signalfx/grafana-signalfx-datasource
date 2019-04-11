'use strict';

System.register(['moment'], function (_export, _context) {
  "use strict";

  var moment, _createClass, StreamHandler;

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  function defer() {
    var res, rej;

    var promise = new Promise(function (resolve, reject) {
      res = resolve;
      rej = reject;
    });

    promise.resolve = res;
    promise.reject = rej;

    return promise;
  }

  return {
    setters: [function (_moment) {
      moment = _moment.default;
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

      _export('StreamHandler', StreamHandler = function () {
        function StreamHandler(signalflow, program, aliases, options, templateSrv) {
          _classCallCheck(this, StreamHandler);

          this.signalflow = signalflow;
          this.program = program;
          this.aliases = aliases;
          this.options = options;
          this.templateSrv = templateSrv;
          this.handle = null;
          this.promise = defer();
        }

        _createClass(StreamHandler, [{
          key: 'start',
          value: function start() {
            this.metrics = {};
            console.log('Starting SignalFlow computation: ' + this.program);
            this.handle = this.signalflow.execute({
              program: this.program,
              start: this.options.range.from.valueOf(),
              resolution: this.options.resolutionMs,
              stop: this.options.range.to.valueOf(),
              immediate: true
            });
            this.handle.stream(this.handleData.bind(this));
            return this.promise;
          }
        }, {
          key: 'handleData',
          value: function handleData(err, data) {

            if (err) {
              this.onError(err.message);
              return;
            }

            if (data.type === 'message' && data.message.messageCode === 'JOB_RUNNING_RESOLUTION') {
              this.options.resolutionMs = data.message.contents.resolutionMs;
              console.debug('Original MDP:' + this.options.maxDataPoints);
              this.options.maxDataPoints = (this.options.range.to.valueOf() - this.options.range.from.valueOf()) / data.message.contents.resolutionMs;
              console.debug('Calculated MDP:' + this.options.maxDataPoints);
            }

            if (data.type === 'control-message' && data.event === 'STREAM_START') {
              var program = this.program;
              this.streamStartTimeout = setTimeout(function () {
                console.warn('Long running job detected: ' + program);
              }, 15000);
            }

            if (data.type === 'control-message' && data.event === 'END_OF_CHANNEL') {
              if (this.streamStartTimeout) {
                clearTimeout(this.streamStartTimeout);
                this.streamStartTimeout = null;
              }
              this.flushData();
              this.onCompleted();
              return;
            }

            if (data.type !== 'data') {
              console.debug(data);
              return;
            }
            this.appendData(data);
          }
        }, {
          key: 'appendData',
          value: function appendData(data) {
            for (var i = 0; i < data.data.length; i++) {
              var point = data.data[i];
              var series = this.metrics[point.tsId];
              if (!series) {
                var tsName = this.getTimeSeriesName(point.tsId);
                series = { target: tsName.name, id: tsName.id, datapoints: [] };
                this.metrics[point.tsId] = series;
              }

              series.datapoints.push([point.value, data.logicalTimestampMs]);
              if (series.datapoints.length > this.options.maxDataPoints) {
                series.datapoints.shift();
              }
            }
          }
        }, {
          key: 'getTimeSeriesName',
          value: function getTimeSeriesName(tsId) {
            var obj = this.handle.get_metadata(tsId);
            if (!obj) {
              return tsId;
            }

            var candidates = ['sf_metric', 'sf_originatingMetric'];
            var excludedDimensions = ['sf_metric', 'sf_originatingMetric', 'jobId', 'programId', 'computationId'];

            var tsVars = {};
            var result = [];
            for (var c in candidates) {
              var value = obj.properties[candidates[c]];
              if (value && !value.toLowerCase().startsWith('_sf_')) {
                tsVars['metric'] = { text: value, value: value };
                result.push(value);
              }
            }

            var key = [];
            for (var k in obj.properties['sf_key']) {
              var dimension = obj.properties['sf_key'][k];
              if (excludedDimensions.indexOf(dimension) === -1) {
                var value = obj.properties[dimension];
                if (value) {
                  key.push(dimension + '=' + value);
                  tsVars[dimension] = { text: value, value: value };
                }
              }
            }

            result.push(key.join(','));

            var repr = '';
            var alias = null;
            if (obj.properties['sf_streamLabel']) {
              tsVars['label'] = { text: obj.properties['sf_streamLabel'], value: obj.properties['sf_streamLabel'] };
              repr += obj.properties['sf_streamLabel'] + ':';
              alias = this.aliases[obj.properties['sf_streamLabel']];
            } else {
              alias = _.find(this.aliases, function (a) {
                return true;
              });
            }
            var id = repr + result.join('/');
            var name = alias ? this.templateSrv.replace(alias, tsVars) : id;
            return { id: id, name: name };
          }
        }, {
          key: 'flushData',
          value: function flushData() {
            var seriesList = [];
            for (var tsId in this.metrics) {
              seriesList.push(this.metrics[tsId]);
            }
            seriesList.sort(function (a, b) {
              return a.id.localeCompare(b.id);
            });
            var start = seriesList.length > 0 ? seriesList[0].datapoints[0][1] : 0;
            var end = seriesList.length > 0 ? seriesList[0].datapoints[seriesList[0].datapoints.length - 1][1] : 0;
            this.onCompleted({
              data: seriesList,
              range: { from: moment(start), to: moment(end) }
            });
          }
        }, {
          key: 'onError',
          value: function onError(error) {
            console.debug('Stream error', error);
            this.promise.reject(error);
          }
        }, {
          key: 'onCompleted',
          value: function onCompleted(data) {
            console.debug('Stream completed ' + this.program);
            this.promise.resolve(data);
          }
        }, {
          key: 'stop',
          value: function stop() {
            if (this.handle) {
              console.debug('Stopping SignalFlow computation.');
              this.handle.close();
              this.handle = null;
            }
          }
        }]);

        return StreamHandler;
      }());

      _export('StreamHandler', StreamHandler);
    }
  };
});
//# sourceMappingURL=stream_handler.js.map
