// Copyright (C) 2019-2020 Splunk, Inc. All rights reserved.
import _ from "lodash";
import { QueryCtrl } from 'app/plugins/sdk';

class SignalFxQueryCtrl extends QueryCtrl {
    constructor($scope, $injector) {
        super($scope, $injector);
        this.lastError = null;
        this.panelCtrl.events.on('data-received', this.onDataReceived.bind(this), $scope);
        this.panelCtrl.events.on('data-error', this.onDataError.bind(this), $scope);
    }
    onDataReceived(dataList) {
        this.lastError = null;
    }

    onDataError(err) {
        this.lastError = err.replace(/(?:\r\n|\r|\n)/g, '<br>');;
    }
}

SignalFxQueryCtrl.templateUrl = 'partials/query.editor.html';
export { SignalFxQueryCtrl };
