var img = {};
img.onload = (function(owner) {
    return function() {
        renderOwner(owner)
    }
})({id: 1});

function renderOwner(owner) {
    console.log('render', owner);
}

img.onload();
