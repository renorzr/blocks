var MODE_NORMAL = 0;
var MODE_TRADE = 1;
var MODE_SETUP = 2;
var BK_SIZE = 10; // block size in pixels
var ROW_BLOCK_NUM = 100; // how many blocks in one row (the same in one column)
var CANVAS_SIZE = BK_SIZE * ROW_BLOCK_NUM;
var TOTAL_BLOCKS = ROW_BLOCK_NUM ** 2;
var blocksApp = angular.module('blocksApp', ['ngRoute']);
var BASE_URL = 'https://testnet.nebulas.io';
var CALL_URL = BASE_URL + '/v1/user/call';
var CONTRACT_ADDRESS = 'n222gn1FXgJMfBqsQMrCYgED8tKxDQxRnWq';
var GET_CALL = '{"from":"n1drJMWfHCzLWR7wEbU9nVry1SGKUr4Gu9J","to":"' + CONTRACT_ADDRESS + '","value":"0","nonce":0,"gasPrice":"1000000","gasLimit":"200000","contract":{"function":"get","args":"[]"}}';
var MARKET_CALL = '{"from":"n1drJMWfHCzLWR7wEbU9nVry1SGKUr4Gu9J","to":"' + CONTRACT_ADDRESS + '","value":"0","nonce":0,"gasPrice":"1000000","gasLimit":"200000","contract":{"function":"market","args":"[]"}}';
var RENDER_DURATION = 100;
var BUY = 0;
var FEE_RATE = 0.01;
var FEE_LEAST = 0.1;
var NebPay = require("nebpay");


blocksApp.config(function($routeProvider) {
    $routeProvider

        .when('/about', {
            templateUrl : 'pages/about.html',
            controller  : 'aboutController'
        })

        .when('/assets', {
            templateUrl : 'pages/assets.html',
            controller  : 'assetsController'
        })
        .otherwise({
            templateUrl : 'pages/home.html',
            controller  : 'homeController'
        })
    ;
});

blocksApp.controller('mainController', function($scope) {
});

blocksApp.controller('homeController', function($scope, $http) {
    window.scope = $scope;
    $scope.blockStatus = [];
    for (var i = 0; i < TOTAL_BLOCKS; i++) {
        $scope.blockStatus.push({});
    }
    $scope.mode = MODE_NORMAL;
    $scope.directions = [0,1];
    $scope.canvas = document.getElementById('canvas');
    $scope.canvasTop = document.getElementById('canvasTop');
    $scope.ctx = canvas.getContext('2d');
    $scope.ctxTop = canvasTop.getContext('2d');
    $scope.orderPrice = 0.1;
    $scope.changedSettings = {};

    $scope.$on('$viewContentLoaded', function(){
        window.postMessage({
            "target": "contentscript",
            "data":{
            },
            "method": "getAccount",
        }, "*");

        $scope.canvasPos = getPos($scope.canvas);

        $http.post(CALL_URL, GET_CALL).then(function(r){
            $scope.overallData = JSON.parse(r.data.result.result);
            render($scope.ctx, $scope.overallData);
        });

        $http.post(CALL_URL, MARKET_CALL).then(function(r){
            var orders = JSON.parse(r.data.result.result);
            $scope.orders = [];
            for (var orderId in orders) {
                var order = orders[orderId];
                order.blocks = parseBlocks(order.blocks);
                if (!order.limit) {
                    order.limit = [1, order.blocks.length];
                }
                $scope.orders.push(order);
            }
        });
    });

    $scope.loadCard = function (e) {
        var currentBlock = getBlockByPos(e.offsetX, e.offsetY);
        if ($scope.lastBlock !== currentBlock) {
            $scope.lastBlock = currentBlock;
            if ($scope.cardTimer) {
                clearTimeout($scope.cardTimer);
                $scope.cardTimer = null;
                $('#card').fadeOut();
            }
            $scope.cardTimer = setTimeout(function(){$scope.showCard(currentBlock)}, 1500);
        }
    }

    $scope.loadHref = function(e) {
        var currentBlock = getBlockByPos(e.offsetX, e.offsetY);
        if ($scope.lastBlock !== currentBlock) {
            $scope.lastBlock = currentBlock;
            var data = $scope.overallData;
            var owner = $scope.getOwnerOfBlock(currentBlock);
            if (owner) {
                var href = owner.href;
                var title = owner.title;
                if (href) {
                    $('#mainLink').attr("href", href);
                    $('#mainLink').attr("title", title);
                } else {
                    $('#mainLink').attr("href", "");
                    $('#mainLink').attr("title", title);
                }
            }
        }
    }

    $scope.mousedown = function(e) {
        $scope.drag = {
            startX: e.offsetX, startY: e.offsetY,
            x: e.offsetX, y: e.offsetY,
            dX: 0, dY: 0
        };
        $scope.updateLastBlock(e.offsetX, e.offsetY);
    }

    $scope.mousemove = function(e) {
        if ($scope.drag) {
            var drag = $scope.drag;
            drag.x = e.offsetX;
            drag.y = e.offsetY;
            drag.dX = drag.x - drag.startX;
            drag.dY = drag.y - drag.startY;
            $scope.updateLastBlock(e.offsetX, e.offsetY);
            $scope.invalidate();
        }
    }

    $scope.mouseup = function(e) {
        if ($scope.newImage) {
            $scope.newImageX += $scope.drag.dX;
            $scope.newImageY += $scope.drag.dY;
        }
        $scope.updateSelectedBlocks();
        $scope.drag = null;
        $scope.invalidate();
        $scope.$apply();
    }

    $scope.updateSelectedBlocks = function () {
        if ($scope.selectable) {
            $scope.selectedBlocks = [];
            for (var blockId in $scope.blockStatus) {
                if ($scope.blockStatus[blockId].selected) {
                    $scope.selectedBlocks.push(blockId);
                }
            }
        }
    }

    $scope.updateLastBlock = function (x, y) {
        var currentBlock = getBlockByPos(x, y);
        if ($scope.lastBlock !== currentBlock) {
            $scope.lastBlock = currentBlock;
            if ($scope.selectable) {
                $scope.selectRectBlocks();
            }
        }
    }

    $scope.selectNone = function () {
        for (var blockId in $scope.blockStatus) {
            $scope.blockStatus[blockId].selected = false;
        }
        $scope.selectedBlocks = [];
        $scope.invalidate();
    }

    $scope.selectRectBlocks = function () {
        var drag = $scope.drag;
        var left = Math.min(drag.x, drag.startX);
        var right = Math.max(drag.x, drag.startX);
        var top = Math.min(drag.y, drag.startY);
        var bottom = Math.max(drag.y, drag.startY);
        var startCol = Math.floor(left / BK_SIZE);
        var startRow = Math.floor(top / BK_SIZE);
        var endCol = Math.floor(right / BK_SIZE);
        var endRow = Math.floor(bottom / BK_SIZE);
        for (var col = startCol; col <= endCol; col++) {
            for (var row = startRow; row <= endRow; row++) {
                var blockId = Math.round(row * ROW_BLOCK_NUM + col);
                var blockStatus = $scope.blockStatus[blockId];
                if (blockStatus.selectable) {
                    blockStatus.selected = true;
                }
            }
        }
    }

    $scope.startTrade = function (orderId) {
        console.log('start trade', orderId);
        $scope.resetTradeBlocks();
        $scope.mode = MODE_TRADE;
        $scope.tradingOrder = $scope.getOrderById(orderId);
        $scope.selectable = $scope.tradingOrder.creator != $scope.myOwnerId;
        $scope.tradingOrder.blocks.forEach(function(blockId){
            $scope.blockStatus[blockId].selectable = true;
        });
        $scope.selectNone();
    }

    $scope.getOrderById = function (orderId) {
        for (var i in $scope.orders) {
            var order = $scope.orders[i];
            if (order.id === orderId) {
                return order;
            }
        }
        return null;
    }

    $scope.exitTrade = function () {
        $scope.restoreOwner();
        $scope.resetTradeBlocks();
    }

    $scope.resetTradeBlocks = function () {
        console.log('reset trade blocks');
        $scope.mode = MODE_NORMAL;
        $scope.tradingOrder = null;
        $scope.newImage = $scope.newImageX = $scope.newImageY = null;
        for (var blockId in $scope.blockStatus) {
            $scope.blockStatus[blockId] = {};
        }
    }

    $scope.confirmTrade = function () {
        var selectedBlockNum = $scope.selectedBlocks.length;
        var limit = $scope.tradingOrder.limit;
        console.log(selectedBlockNum, limit);
        if (selectedBlockNum < parseInt(limit[0]) || selectedBlockNum  > parseInt(limit[1])) {
            alert("本交易单限制交易格子数在" + limit.join(" - ") + "之间");
            return;
        }
        $('#tradeModal').modal();
        $scope.totalPrice = $scope.tradingOrder.price * $scope.selectedBlocks.length;
        $scope.fee = Math.max($scope.totalPrice * FEE_RATE, FEE_LEAST);
        if ($scope.tradingOrder.direction === BUY) {
            $scope.pay = $scope.totalPrice - $scope.fee;
        } else {
            $scope.pay = $scope.totalPrice + $scope.fee;
        }
    }

    $scope.orderTotalPrice = function () {
        return $scope.selectedBlocks.length * $scope.orderPrice;
    }

    $scope.setLink = function () {
        $('#linkModal').modal();
        var owner = $scope.getOwner();
        $scope.linkSettings = {
            href: owner.href,
            title: owner.title
        }
    }

    $scope.saveLinkSettings = function () {
        var owner = $scope.getOwner();
        owner.href = $scope.changedSettings.href = $scope.linkSettings.href;
        owner.title = $scope.changedSettings.title = $scope.linkSettings.title;
        $('#linkModal').modal('hide');
    }


    $scope.trade = function () {
        var order = $scope.tradingOrder;
        var nebpay = new NebPay();
        var blocks = stringifyBlocks($scope.selectedBlocks);
        var pay = order.direction ? $scope.pay : 0;
        var args = JSON.stringify([order.direction, order.id, blocks]);
        nebpay.call(CONTRACT_ADDRESS, pay.toFixed(5), "trade", args, { listener: txCallback(scope) });
    }

    $scope.startOrder = function (direction) {
        $scope.resetTradeBlocks();
        $scope.orderDirection = direction;
        var sell = direction;
        $scope.mode = MODE_TRADE;
        $scope.tradingOrder = null;
        $scope.selectable = true;
        var blocks = $scope.overallData.blocks;
        for (var blockId in blocks) {
            var ownerId = blocks[blockId];
            var isMine = ownerId === $scope.myOwnerId;
            $scope.blockStatus[blockId].selectable = (sell && isMine) || (!sell && !isMine);
        };
        $scope.selectNone();
    }

    $scope.cancelOrder = function () {
        var nebpay = new NebPay();
        var args = JSON.stringify([$scope.tradingOrder.id]);
        nebpay.call(CONTRACT_ADDRESS, 0, "cancel", args, { listener: txCallback(scope) });
    }

    getBlockByPos = function (x, y) {
        var col = Math.floor(x / BK_SIZE);
        var row = Math.floor(y / BK_SIZE);
        return row * ROW_BLOCK_NUM + col;
    }

    $scope.invalidate = function() {
        var drag = $scope.drag;
        var ctx = $scope.ctxTop;
        $scope.clear();
        ctx.globalAlpha = 1;
        if ($scope.selectable && drag) {
            ctx.strokeRect(drag.startX, drag.startY, drag.dX, drag.dY);
        }
        if ($scope.newImage) {
            var img = $scope.newImage;
            var x = $scope.newImageX;
            var y = $scope.newImageY;
            if (drag) {
                x += drag.dX;
                y += drag.dY;
            }
            ctx.drawImage(img, x, y);
        }
        ctx.globalAlpha = 0.8;
        for (var blockId in $scope.blockStatus) {
            var pos = blockPos(blockId);
            var x = pos.x;
            var y = pos.y;
            var blockStatus = $scope.blockStatus[blockId];
            ctx.strokeStyle = "#a0a0a0";
            ctx.strokeRect(x, y, BK_SIZE, BK_SIZE);
            if (!blockStatus.highlight) {
                ctx.strokeStyle = "#000000";
                ctx.fillStyle = "#a0a0a0";
                ctx.fillRect(x, y, BK_SIZE, BK_SIZE);
            }
            if (blockStatus.selected) {
                ctx.fillStyle = "#0000ff";
                ctx.fillRect(x, y, BK_SIZE, BK_SIZE);
            }
            if (blockStatus.selectable) {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(x, y, BK_SIZE, BK_SIZE);
                ctx.strokeStyle = "#000000";
                ctx.strokeRect(x, y, BK_SIZE, BK_SIZE);
            }
        };
    }

    $scope.clear = function () {
        $scope.canvasTop.height = $scope.canvasTop.height;
    }

    $scope.confirmOrder = function () {
        $scope.minBlocks = $scope.maxBlocks = $scope.selectedBlocks.length;
        $('#orderModal').modal();
    }

    $scope.createOrder = function () {
        var blocks = stringifyBlocks($scope.selectedBlocks);
        var limit = [$scope.minBlocks, $scope.maxBlocks];
        var nebpay = new NebPay();
        var args = JSON.stringify([$scope.orderDirection, parseFloat($scope.orderPrice), blocks, limit]);
        var value = $scope.orderDirection ? 0 : $scope.orderTotalPrice().toFixed(5);
        nebpay.call(CONTRACT_ADDRESS, value, "order", args, { listener: txCallback(scope) });
    }

    $scope.onNebMessage = function (data) {
        if (data.account) {
            console.log('account', data.account);
            $scope.account = data.account;
            var mineCall = '{"from":"' + $scope.account + '","to":"' + CONTRACT_ADDRESS + '","value":"0","nonce":0,"gasPrice":"1000000","gasLimit":"200000","contract":{"function":"mine","args":"[]"}}';
            $http.post(CALL_URL, mineCall).then(function(r){
                var data = JSON.parse(r.data.result.result);
                $scope.myOwnerId = data.id;
            });
        }
        if(data.txhash) {
            console.log('txhash', data.txhash);
        }
        if(data.receipt) {
            console.log('receipt', data.receipt);
        }
        if(data.neb_call){
            console.log('neb_call', data.neb_call);
        }
    }

    $scope.closeTxModal = function () {
        window.location.reload();
    }

    $scope.setup = function () {
        $scope.backupOwner();
        $scope.resetTradeBlocks();
        $scope.mode = MODE_SETUP;
        $scope.selectable = false;
        var blocks = $scope.overallData.blocks;
        for (var blockId in blocks) {
            var ownerId = blocks[blockId];
            var isMine = ownerId === $scope.myOwnerId;
            $scope.blockStatus[blockId].highlight = isMine;
        };
        $scope.selectNone();
    }

    $scope.addPic = function () {
        $('#image-input').click();
        $('#image-input').change(function() {loadImg($scope)});
    }

    $scope.getOwner = function() {
        return $scope.overallData.owners[$scope.myOwnerId];
    }

    $scope.assembleImage = function () {
        if ($scope.newImage) {
            var owner = $scope.getOwner();
            var img = $scope.newImage;
            var blocks = $scope.overallData.blocks;
            var leftMostCol = ROW_BLOCK_NUM;
            var rightMostCol = 0;
            var topMostRow = ROW_BLOCK_NUM;
            var bottomMostRow = 0;

            for (var blockId in blocks) {
                var ownerId = blocks[blockId];
                if (ownerId === $scope.myOwnerId) {
                    var row = Math.floor(blockId / ROW_BLOCK_NUM);
                    var col = blockId % ROW_BLOCK_NUM;
                    leftMostCol = Math.min(leftMostCol, col);
                    rightMostCol = Math.max(rightMostCol, col);
                    topMostRow = Math.min(topMostRow, row);
                    bottomMostRow = Math.max(bottomMostRow, row);
                }
            }

            var leftMost = leftMostCol * BK_SIZE;
            var topMost = topMostRow * BK_SIZE;
            var assembleCanvas = document.getElementById('assemble');
            assembleCanvas.width = (rightMostCol - leftMostCol + 1) * BK_SIZE;
            assembleCanvas.height = (bottomMostRow - topMostRow + 1) * BK_SIZE;
            var ctx = assembleCanvas.getContext('2d');

            for (var blockId in blocks) {
                var ownerId = blocks[blockId];
                if (ownerId === $scope.myOwnerId) {
                    var ownerId = blocks[blockId];
                    var pos = blockPos(blockId);
                    var x = pos.x;
                    var y = pos.y;
                    var clipX = Math.round(x - $scope.newImageX);
                    var clipY = Math.round(y - $scope.newImageY);
                    if (clipX > -BK_SIZE && clipY > -BK_SIZE && clipX < img.width && clipY < img.height) {
                        ctx.drawImage(img, clipX, clipY, BK_SIZE, BK_SIZE, x - leftMost, y - topMost, BK_SIZE, BK_SIZE);
                    } else {
                        renderBlock(ctx, owner, blockId, -leftMost, -topMost);
                    }
                }
            }
            var blockOffset = topMostRow * ROW_BLOCK_NUM + leftMostCol;
            owner.offset = stringifyBlocks([blockOffset]);
            owner.img = assembleCanvas.toDataURL('image/webp');
            console.log('img len=', owner.img.length);
            $scope.changedSettings.img = owner.img;
            $scope.changedSettings.offset = owner.offset;

            owner.loaded = false;
            $scope.newImage = null;
            render($scope.ctx, $scope.overallData);
            $scope.invalidate();
        }
    }

    $scope.cancelAddPic = function() {
        $scope.newImage = null;
        $scope.invalidate();
    }

    $scope.save = function () {
        callContract(0, "configure", $scope.changedSettings);
    }

    $scope.backupOwner = function () {
        $scope.ownerBackup = $.extend({}, $scope.getOwner());
    }

    $scope.restoreOwner = function () {
        if ($scope.ownerBackup) {
            $scope.overallData.owners[$scope.myOwnerId] = $scope.ownerBackup;
        }
    }

    $scope.showCard = function (blockId) {
        var owner = $scope.getOwnerOfBlock(blockId);
        var pos = blockPos(blockId);
        var card = $('#card');
        var width = card.width();
        var height = card.height();
        var canvasPos = getPos($scope.canvas);
        var x = pos.x - width / 2;
        var y = pos.y - height / 2;
        if (x < 0) x = 0;
        if (x > CANVAS_SIZE - width) x = CANVAS_SIZE - width;
        if (y < 0) y = 0;
        if (y > CANVAS_SIZE - height) y = CANVAS_SIZE - height;
        card.css('left', canvasPos[0] + x).css('top', canvasPos[1] + y).fadeIn();
    }

    $scope.getOwnerOfBlock = function (blockId) {
        var data = $scope.overallData;
        return data && data.owners[data.blocks[blockId]];
    }
});

blocksApp.controller('aboutController', function($scope) {
});

blocksApp.controller('assetsController', function($scope) {
});

function callContract(value, method) {
    var args = Array.prototype.slice.call(arguments, 2);
    var nebpay = new NebPay();
    nebpay.call(CONTRACT_ADDRESS, value, method, JSON.stringify(args), { listener: txCallback(scope) });
}

function render(ctx, data) {
    for (var ownerId in data.owners) {
        var owner = data.owners[ownerId];
        if (!owner.img) continue;
        console.log('render', typeof(owner.img), owner.img.length, owner.img.width);
        var img = new Image();
        img.src = owner.img;
        owner.img = img;
        var offsetBlock = owner.offset ? parseBlocks(owner.offset)[0] : 0;
        var pos = blockPos(offsetBlock);
        owner.offsetX = pos.x;
        owner.offsetY = pos.y;
        console.log('owner.loaded=', owner.loaded);
        img.onload = (function(owner) {
            return function() {
                console.log('owner img loaded');
                owner.loaded = true;
            }
        })(owner);
    }
    for (var i = 0; i < data.blocks.length; i++) {
        var ownerId = data.blocks[i];
        var owner = data.owners[ownerId];
        renderOnLoad(ctx, owner, i);
    }
}

function renderOnLoad(ctx, owner, blockId) {
    if (owner.loaded) {
        renderBlock(ctx, owner, blockId);
    } else {
        setTimeout(function(){renderOnLoad(ctx, owner, blockId)}, Math.random() * RENDER_DURATION);
    }
}

function renderBlock(ctx, owner, blockId, offsetX, offsetY) {
    if (!offsetX) offsetX = 0;
    if (!offsetY) offsetY = 0;
    var img = owner.img;
    var pos = blockPos(blockId);
    var clipX = Math.round(pos.x - owner.offsetX);
    var clipY = Math.round(pos.y - owner.offsetY);
    if (clipX > -BK_SIZE && clipY > -BK_SIZE && clipX < img.width && clipY < img.height) {
        ctx.drawImage(img, clipX, clipY, BK_SIZE, BK_SIZE, pos.x + offsetX, pos.y + offsetY, BK_SIZE, BK_SIZE);
    }
}

function blockPos(blockId) {
    var row = Math.floor(blockId / ROW_BLOCK_NUM);
    var col = blockId % ROW_BLOCK_NUM;
    return {
        row: row,
        col: col,
        x: Math.round(col * BK_SIZE),
        y: Math.round(row * BK_SIZE)
    }
}

function getPos(ele){
    var x=0;
    var y=0;
    while(true){
        x += ele.offsetLeft;
        y += ele.offsetTop;
        if(ele.offsetParent === null){
            break;
        }
        ele = ele.offsetParent;
    }
    return [x, y];
}

function txCallback(scope) {
    return function (data) {
        console.log('tx callback', data);
        $('.modal').modal('hide');
        scope.$apply(function () {scope.txhash = data.txhash});
        $('#txModal').modal();
    }
}

window.addEventListener('message', function(e) {
    if (e.data.data) scope.onNebMessage(e.data.data);
});

function loadImg(scope){
    var file = $("#image-input")[0].files[0];
    var reader = new FileReader();
    var imgFile;
    reader.onload=function(e) {
        var img = new Image();
        img.src = e.target.result;
        scope.newImageX = scope.newImageY = 0;
        scope.newImage = img;
        img.onload = function () {
            scope.invalidate();
            setTimeout(function(){scope.$apply();}, 10);
        }
    };

    reader.readAsDataURL(file);
}

$(window).scroll(function (e) {
    var toolbar = $('#toolbar');
    var isPositionFixed = (toolbar.css('position') == 'fixed');
    var scrollBottom = $(this).scrollTop() + window.innerHeight;
    if (!isPositionFixed) {
        var toolbarTop = getPos(toolbar[0])[1];
        if (scrollBottom < toolbarTop + toolbar.height()) {
            toolbar.attr('originTop', toolbarTop);
            toolbar.css({'position': 'fixed', 'bottom': '0px'});
        }
    } else if (scrollBottom > parseInt(toolbar.attr('originTop')) + toolbar.height()) {
        toolbar.css({'position': '', 'bottom': ''});
    }
});

