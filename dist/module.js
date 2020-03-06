'use strict';

System.register(['./datasource', './query_ctrl', './config_ctrl'], function (_export, _context) {
    "use strict";

    var SignalFxDatasource, SignalFxQueryCtrl, SignalFxConfigCtrl;
    return {
        setters: [function (_datasource) {
            SignalFxDatasource = _datasource.SignalFxDatasource;
        }, function (_query_ctrl) {
            SignalFxQueryCtrl = _query_ctrl.SignalFxQueryCtrl;
        }, function (_config_ctrl) {
            SignalFxConfigCtrl = _config_ctrl.SignalFxConfigCtrl;
        }],
        execute: function () {
            _export('Datasource', SignalFxDatasource);

            _export('QueryCtrl', SignalFxQueryCtrl);

            _export('ConfigCtrl', SignalFxConfigCtrl);
        }
    };
});
//# sourceMappingURL=module.js.map
