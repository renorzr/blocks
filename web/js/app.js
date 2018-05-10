var CHAR_CODE_OF_A = 'A'.charCodeAt();
var BASE = 26;
var BK_SIZE = 10; // block size in pixels
var ROW_BLOCK_NUM = 100; // how many blocks in one row (the same in one column)
var blocksApp = angular.module('blocksApp', ['ngRoute']);
var BASE_URL = 'https://testnet.nebulas.io';
var GET_CALL = '{"from":"n1drJMWfHCzLWR7wEbU9nVry1SGKUr4Gu9J","to":"n1sqKJDAxiXhkBTCBbic8eFzy3AWX5ZdPYy","value":"0","nonce":0,"gasPrice":"1000000","gasLimit":"200000","contract":{"function":"get","args":"[]"}}';

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
    $scope.$on('$viewContentLoaded', function(){
        $http.post(BASE_URL + '/v1/user/call', GET_CALL).then(function(r){
            var data = JSON.parse(r.data.result.result);
            render(data);
            $scope.sellings = [];
            for (var ownerId in data.owners) {
                var owner = data.owners[ownerId];
                var selling = owner.selling;
                if (selling) {
                    selling.ownerId = ownerId;
                    $scope.sellings.push(selling);
                }
            }
            $scope.sellings = [
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
                {price: 0.1, blocks: 100, limit: [10, 100], to: null},
            ];
        });
    });
});

blocksApp.controller('aboutController', function($scope) {
});

blocksApp.controller('assetsController', function($scope) {
});

function parseBlocks(blocks) {
    var result = [];
    for (var i = 0; i < blocks.length; i+=3) {
        var n = 0;
        var base = 1;
        for (var j = 0; j < 3; j++) {
            var d = blocks.charCodeAt(i + j) - CHAR_CODE_OF_A;
            n += d * base;
            base *= BASE;
        }
        result.push(n);
    }
    return result;
}

function stringifyBlocks(blocks) {
   var result = '';
   blocks.forEach(function(blockId){
       var n = blockId;
       for (var i = 0; i < 3; i++) {
           result += String.fromCharCode(n % BASE + CHAR_CODE_OF_A);
           n = Math.floor(n / BASE);
       }
   });
   return result;
}

function render(data) {
    var ctx = document.getElementById('canvas').getContext('2d');
    for (var i = 0; i < data.blocks.length; i++) {
        var ownerId = data.blocks[i];
        var owner = data.owners[ownerId];
        if (!owner.blocks) {owner.blocks = [];}
        owner.blocks.push(i);
    }
    shuffle(owner.blocks);
    for (var ownerId in data.owners) {
        var owner = data.owners[ownerId];
        console.log('owner[' + ownerId + ']=', owner);
        if (!owner.img) continue;
        var img = new Image();
        img.src = owner.img;
        owner.img = img;
        var offsetBlock = owner.offset ? parseBlocks(owner.offset)[0] : 0;
        var offsetRow = Math.round(offsetBlock / ROW_BLOCK_NUM);
        var offsetCol = Math.round(offsetBlock % ROW_BLOCK_NUM);
        owner.offsetX = Math.round(offsetCol * BK_SIZE);
        owner.offsetY = Math.round(offsetRow * BK_SIZE);
        img.onload = (function(owner) {
            return function() {
                renderOwner(ctx, owner)
            }
        })(owner);
    }
}

function renderOwner(ctx, owner) {
    console.log('renderOwner', ctx, owner);
    owner.blocks.forEach(function(blockId) {
        setTimeout(function() {
            renderBlock(ctx, owner, blockId)
        }, 1);
    });
}

function renderBlock(ctx, owner, blockId) {
    var img = owner.img;
    var row = blockId / ROW_BLOCK_NUM;
    var col = blockId % ROW_BLOCK_NUM;
    var x = col * BK_SIZE;
    var y = row * BK_SIZE;
    var clipX = Math.round(x - owner.offsetX);
    var clipY = Math.round(y - owner.offsetY);
    if (clipX > -BK_SIZE && clipY > -BK_SIZE && clipX < img.width && clipY < img.height) {
        ctx.drawImage(img, clipX, clipY, BK_SIZE, BK_SIZE, x, y, BK_SIZE, BK_SIZE);
    }
}

function shuffle(array) {
  var m = array.length, t, i;

  while (m) {
    i = Math.floor(Math.random() * m--);
    t = array[m];
    array[m] = array[i];
    array[i] = t;
  }
}

