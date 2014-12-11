/**
 * @file 列表形式的MVC - Action
 *
 * @author Leo Wang(wangkemiao@baidu.com)
 */

define(function (require) {
    'use strict';

    var _ = require('underscore');
    var fc = require('fc-core');
    var Promise = require('fc-core/Promise');

    var viewUtil = require('common/viewUtil');

    require('fcui/Table');
    require('esui/extension/Command');
    require('fcui/Pager');

    /**
     * 列表形式的MVC - Action
     */
    var overrides = {};

    /**
     * 初始化交互
     */
    overrides.initBehavior = function () {
        this.view.on('search', function (e) {
            this.redirect(this.model.resolveQuery(e.data));
        }, this);
        this.customBehavior();
    };

    overrides.customBehavior = _.noop;

    function waitExecute(method, args, thisObject) {
        var waiting = method.apply(thisObject, args);

        return waiting;
    }

    function showCellLoading(table, row, col) {
        fc.assert.equals(_.isArray(row), true, '参数`row`必须为数组！');
        fc.assert.equals(_.isArray(col), true, '参数`col`必须为数组！');
        _.each(row, function (eachRow) {
            _.each(col, function (eachCol) {
                table.setCellText(
                    viewUtil.getInlineLoading(),
                    eachRow, eachCol
                );
            });
        });
    }

    function showRowLoading(table, row) {
        fc.assert.equals(_.isArray(row), true, '参数`row`必须为数组！');
        _.each(row, function (eachRow) {
            $(table.getRow(eachRow)).css('position', 'relative').append(
                $('<div class="loading-table-line"></div>').css({
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'gray',
                    opacity: 0.5,
                    cursor: 'not-allowed'
                })
            );
        });
    }

    function clearRowLoading(table) {
        $(table.main).find('.loading-table-line').remove();
    }

    /**
     * 执行单个行内修改行为的命令
     * @param {Function} method 要执行的方法
     * @param {Object} e 事件的参数
     * @param {string} e.type 事件类型，例如pause
     * @param {Object} e.data 事件附带数据
     * @param {Object=} e.data.args 本次执行方法的参数
     * @param {number|Array.<number>} e.data.row 表示所在行，如果是多个则为批量
     * @param {number|Array.<number>=} e.data.col 表示所在列，会影响刷新模式
     * @param {Object=} extraRowData 额外的参数，在执行成功后补充入saved事件的newData
     * @return {Promise}
     */
    function inlineModify(method, e, extraRowData) {
        var me = this;
        var row = e.data.row;
        var col = e.data.col;
        var args = e.data.args;

        if (_.isArray(row)) {
            row = row[0];
        }
        if (_.isArray(col)) {
            col = col[0];
        }

        var listTable = me.view.get('list-table');
        // 展现行内loading，但是取决于col是否存在……
        if (!extraRowData || extraRowData._executedSource !== 'component') {
            if (!col) {
                // 使用行刷新模式
                showRowLoading(listTable, [row]);
            }
            else {
                showCellLoading(listTable, [row], [col]);
            }
        }
        return waitExecute(method, args, me)
            .then(function (response) {
                /**
                 * @type {Object} key为datasource中的行索引，value为具体值
                 */
                var processedData = me.processExecuteModifyResponse(
                    response, e, extraRowData
                );

                // 行更新
                clearRowLoading(listTable);
                _.each(processedData, function (item, index) {
                    var newData = _.extend(
                        listTable.datasource[index],
                        item,
                        extraRowData
                    );
                    if (newData) {
                        listTable.updateRowAt(row, newData);
                    }
                });
                return Promise.resolve(response);
            }, function (response) {
                clearRowLoading(listTable);
                return Promise.reject(response);
            });
    }

    /**
     * 执行批量修改行为的命令
     * @param {Function} method 要执行的方法
     * @param {Object} e 事件的参数
     * @param {string} e.type 事件类型，例如pause
     * @param {Object} e.data 事件附带数据
     * @param {Object=} e.data.args 本次执行方法的参数
     * @param {number|Array.<number>} e.data.row 表示所在行，如果是多个则为批量
     * @param {number|Array.<number>=} e.data.col 表示所在列，会影响刷新模式
     * @param {Object=} extraRowData 额外的参数，在执行成功后补充入saved事件的newData
     * @return {Promise}
     */
    function multiModify(method, e, extraRowData) {
        var me = this;
        var row = e.data.row;
        // var col = e.data.col;
        var args = e.data.args;

        var listTable = this.view.get('list-table');

        if (!extraRowData || extraRowData._executedSource !== 'component') {
            // 这时候只有row了，没有col
            // 先不处理loading了，但是可以先禁用或者做些展现处理
            // like this
            showRowLoading(listTable, row);
        }

        return waitExecute(method, args, this)
            .then(function (response) {
                /**
                 * @type {Object} key为datasource中的行索引，value为具体值
                 */
                var processedData = me.processExecuteModifyResponse(
                    response, e, extraRowData
                );

                var updatedDatasource = _.map(
                    listTable.datasource,
                    function (item, index) {
                        if (processedData[index]) {
                            return _.extend(
                                item,
                                processedData[index],
                                extraRowData
                            );
                        }
                        return item;
                    }
                );
                // 刷新表格
                clearRowLoading(listTable);
                listTable.setDatasource(updatedDatasource);
                listTable.set('selectedIndex', row);
                require('common/messager').notify(
                    '修改完成', 1000
                );
                return Promise.resolve(response);
            }, function (response) {
                clearRowLoading(listTable);
                return Promise.reject(response);
            });

    }

    /**
     * 执行某个修改行为的命令
     * 区分单个和批量
     * @param {Function} method 要执行的方法
     * @param {Object} e 事件的参数
     * @param {string} e.type 事件类型，例如pause
     * @param {Object} e.data 事件附带数据
     * @param {Object=} e.data.args 本次执行方法的参数
     * @param {number|Array.<number>} e.data.row 表示所在行，如果是多个则为批量
     * @param {number|Array.<number>=} e.data.col 表示所在列，会影响刷新模式
     * @param {Object=} extraRowData 额外的参数，在执行成功后补充入saved事件的newData
     * @return {Promise}
     */
    overrides.executeModifyCommand = function (method, e, extraRowData) {
        fc.assert.has(method, 'executeModifyCommand方法必须指定参数`method`');
        fc.assert.has(e, 'executeModifyCommand方法必须指定参数`e`');
        fc.assert.hasProperty(
            e.data, 'row',
            'executeModifyCommand的参数`e.data`必须有属性`row`'
        );

        var isMulti = _.isArray(e.data.row) && e.data.row.length > 1;

        // 区分了执行方法是因为刷新模式不一样
        var modifyMethod = isMulti ? multiModify : inlineModify;
        var executing = modifyMethod.apply(this, arguments);
        executing.then(_.bind(this.afterExecuteModifyCommand, this));

        return executing;
    };

    /**
     * 修改行为执行成功之后处理返回的数据，类似于table的datasource，然后更新表格
     * @param {Object} response 执行结果
     * @param {Object} e 事件的参数
     * @param {string} e.type 事件类型，例如pause
     * @param {Object} e.data 事件附带数据
     * @param {Object=} e.data.args 本次执行方法的参数
     * @param {number|Array.<number>} e.data.row 表示所在行，如果是多个则为批量
     * @param {number|Array.<number>=} e.data.col 表示所在列，会影响刷新模式
     * @param {Object=} extraRowData 额外的参数，在执行成功后补充入saved事件的newData
     * @return {Object} key为行索引，value为具体值
     */
    overrides.processExecuteModifyResponse = function (
        response, e, extraRowData) {
        return response;
    };

    /**
     * 进行了某个修改行为的命令成功之后的后置处理
     * @param {Object} e 事件的参数
     * @param {string} e.type 事件类型，例如pause
     * @param {Object} e.data 事件附带数据
     * @param {Object=} e.data.args 本次执行方法的参数
     * @param {number|Array.<number>} e.data.row 表示所在行，如果是多个则为批量
     * @param {number|Array.<number>=} e.data.col 表示所在列，会影响刷新模式
     */
    overrides.afterExecuteModifyCommand = function (e) { };

    var ListAction = fc.oo.derive(require('./EntryAction'), overrides);

    return ListAction;
});