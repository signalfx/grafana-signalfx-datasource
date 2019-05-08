'use strict';

System.register(['lodash', 'moment'], function (_export, _context) {
  "use strict";

  var _, moment, _createClass, MAX_DATAPOINTS_TO_KEEP_BEFORE_TIMERANGE, StreamHandler;

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
    setters: [function (_lodash) {
      _ = _lodash.default;
    }, function (_moment) {
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

      MAX_DATAPOINTS_TO_KEEP_BEFORE_TIMERANGE = 1;

      _export('StreamHandler', StreamHandler = function () {
        function StreamHandler(signalflow, templateSrv) {
          _classCallCheck(this, StreamHandler);

          this.signalflow = signalflow;
          this.templateSrv = templateSrv;
        }

        _createClass(StreamHandler, [{
          key: 'start',
          value: function start(program, aliases, options) {
            this.promise = defer();
            if (this.isJobReusable(program, options)) {
              this.initializeTimeRange(options);
              this.flushData();
            } else {
              this.stop();
              this.execute(program, aliases, options);
            }
            return this.promise;
          }
        }, {
          key: 'isJobReusable',
          value: function isJobReusable(program, options) {
            return this.handle && this.program == program && this.intervalMs == options.intervalMs && (this.stopTimeRaw == 'now' && this.startTimeRaw == options.rangeRaw.from.valueOf() || this.startTime == options.range.from.valueOf() && this.stopTime == options.range.to.valueOf());
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
        }, {
          key: 'execute',
          value: function execute(program, aliases, options) {
            console.log('Starting SignalFlow computation: ' + program);
            this.initialize(program, aliases, options);
            var params = {
              program: this.program,
              start: this.startTime,
              resolution: this.intervalMs
            };
            if (!this.unbounded) {
              params['stop'] = this.stopTime;
              params['immediate'] = true;
            }
            this.handle = this.signalflow.execute(params);
            this.handle.stream(this.handleData.bind(this));
            if (this.jobStartTimeout) {
              clearTimeout(this.jobStartTimeout);
            }
            this.jobStartTimeout = setTimeout(function () {
              console.debug('Job inactive for 6 minutes: ' + program);
              this.stop();
            }, 360000);
          }
        }, {
          key: 'initialize',
          value: function initialize(program, aliases, options) {
            this.metrics = {};
            this.program = program;
            this.aliases = aliases;
            this.initializeTimeRange(options);
            this.intervalMs = options.intervalMs;
            this.maxDataPoints = options.maxDataPoints;
            this.resolutionMs = options.intervalMs;
            this.maxDelay = 0;
            this.unbounded = options.rangeRaw.to == 'now';
            this.unboundedBatchPhase = this.unbounded;
            this.relativeStart = this.startTimeRaw != this.startTime;
            this.returnedDataPoints = 0;
          }
        }, {
          key: 'initializeTimeRange',
          value: function initializeTimeRange(options) {
            this.startTime = options.range.from.valueOf();
            this.stopTime = options.range.to.valueOf();
            this.startTimeRaw = options.rangeRaw.from.valueOf();
            this.stopTimeRaw = options.rangeRaw.to.valueOf();
          }
        }, {
          key: 'handleData',
          value: function handleData(err, data) {
            var _this = this;

            if (err) {
              console.debug('Stream error', err);
              this.stop();
              this.promise.reject(err.message);
              return;
            }

            if (data.type === 'message' && data.message.messageCode === 'JOB_RUNNING_RESOLUTION') {
              this.resolutionMs = data.message.contents.resolutionMs;
            }

            if (data.type === 'message' && data.message.messageCode === 'JOB_INITIAL_MAX_DELAY') {
              this.maxDelay = data.message.contents.maxDelayMs;
            }

            if (data.type === 'control-message' && data.event === 'END_OF_CHANNEL') {
              this.flushData();
            }

            if (data.type !== 'data') {
              console.debug(data);
              return;
            }

            if (this.appendData(data) && this.unboundedBatchPhase) {
              if (this.batchPhaseFlushTimeout) {
                clearTimeout(this.batchPhaseFlushTimeout);
              }
              this.batchPhaseFlushTimeout = setTimeout(function () {
                return _this.flushData();
              }, 1000);
            }
          }
        }, {
          key: 'appendData',
          value: function appendData(data) {
            var period = this.stopTime - this.startTime;
            var slidingWindowStart = data.logicalTimestampMs - period - MAX_DATAPOINTS_TO_KEEP_BEFORE_TIMERANGE * this.resolutionMs;
            for (var i = 0; i < data.data.length; i++) {
              var point = data.data[i];
              var datapoints = this.metrics[point.tsId];
              if (!datapoints) {
                datapoints = [];
                this.metrics[point.tsId] = datapoints;
              }
              while (datapoints.length > 0 && this.relativeStart && slidingWindowStart > datapoints[0][1]) {
                datapoints.shift();
              }
              datapoints.push([point.value, data.logicalTimestampMs]);
            }
            var nextAdjustedTime = data.logicalTimestampMs + this.maxDelay + this.resolutionMs;
            return nextAdjustedTime > this.stopTime;
          }
        }, {
          key: 'flushData',
          value: function flushData() {
            this.unboundedBatchPhase = false;
            var seriesList = [];
            var minTime = 0;
            var maxTime = 0;
            var timeRangeStart = this.startTime - MAX_DATAPOINTS_TO_KEEP_BEFORE_TIMERANGE * this.resolutionMs;
            for (var tsId in this.metrics) {
              var datapoints = this.metrics[tsId];
              while (datapoints.length > 0 && timeRangeStart > datapoints[0][1]) {
                datapoints.shift();
              }
              if (datapoints.length > 0) {
                if (minTime == 0 || minTime > datapoints[0][1]) {
                  minTime = datapoints[0][1];
                }
                if (maxTime == 0 || maxTime < datapoints[datapoints.length - 1][1]) {
                  maxTime = datapoints[datapoints.length - 1][1];
                }
              }
              var tsName = this.getTimeSeriesName(tsId);
              seriesList.push({ target: tsName.name, id: tsName.id, datapoints: datapoints.slice() });
            }
            // Ensure consistent TS order
            seriesList.sort(function (a, b) {
              return a.id.localeCompare(b.id);
            });
            var data = {
              data: seriesList,
              range: { from: moment(minTime), to: moment(maxTime) }
            };
            this.promise.resolve(data);
            console.debug('Data returned: ' + this.program);
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
        }]);

        return StreamHandler;
      }());

      _export('StreamHandler', StreamHandler);
    }
  };
});
//# sourceMappingURL=stream_handler.js.map
