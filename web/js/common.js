var EDGE_BLOCK_NUM = 100; // how many blocks in one row (the same in one column)
var TOTAL_BLOCKS = EDGE_BLOCK_NUM * EDGE_BLOCK_NUM ;
var BUY = 0;
var SELL = 1;
var BASE = 26;
var CHAR_CODE_OF_A = 65;
var LOWEST_PRICE = 0.01;


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

