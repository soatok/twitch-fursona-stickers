/** First, load prerequisites... **/
const { remote } = require('electron');
const { Menu, MenuItem } = remote;
const { dialog } = require('electron').remote;
const changeTime = require('change-file-time');
const fs = require('fs');
const ipc = require('electron').ipcRenderer;
const nodeConsole = require('console');
const prompt = require('electron-prompt');
const Settings = require('./settings');
const { Sortable } = require('@shopify/draggable');
const Stickers = require('./stickers.js');

/** Initialize some variables to be used throughout the lifetime of the app: */
window.$ = window.jQuery = require('jquery');
let myConsole = new nodeConsole.Console(process.stdout, process.stderr);
let activeProfile;
let activeProfilePath;
let contextMenuTarget;
let dragFrom, dragOver;
let isWindowsAdmin = false;
/** @var {Settings} config */
let config;
let dragDrop;
let draggedId;
let draggedAtAll;
let filterActive = false;

/**
 * Append an image to the DOM.
 *
 * @param imageObject
 * @param index
 */
function appendImage(imageObject, index = 0) {
    try {
        $('#sticker-container').append(
            renderImagePreview(imageObject, index)
        );
        $(`.sticker[data-index=${index}]`).on('click', stickerOnClickEvent);
    } catch (e) {
        myConsole.log(e);
    }
}

function contextMenuEditTags() {
    let id = contextMenuTarget.getAttribute('id');
    if (id.match(/^image\-[0-9]+$/)) {
        index = $(`#${id}`).data('index');
    } else if (id.match(/^image\-[0-9]+\-container$/)) {
        index = $(`#${id} img`).data('index');
    } else {
        return;
    }
    ipc.send('editTagMenu', {
        "images": activeProfile.getAllImages(),
        "id": index
    });
}

/**
 * Delete a sticker from the pack.
 */
function contextMenuRemove() {
    let id = contextMenuTarget.getAttribute('id');
    let index = -1;
    if (id.match(/^image-[0-9]+$/)) {
        index = $(`#${id}`).data('index');
    } else if (id.match(/^image-[0-9]+-container$/)) {
        index = $(`#${id} img`).data('index');
    } else {
        return;
    }
    activeProfile.removeSticker(index);
    setTimeout(() => {
            redrawImages(true);
            return filterByTags();
        },
        1
    );
}

/**
 * Detect which sticker is the target of the symlink, mark it as active.
 *
 * Otherwise, mark the transparent space as active.
 */
function detectActiveSymlink() {
    let link = activeProfile.getSymlink();
    if (fs.existsSync(link)) {
        let realpath = fs.realpathSync(link);
        if (realpath.length > 0) {
            let len = activeProfile.getImageCount();
            let img;
            for (let i = 0; i < len; i++) {
                img = activeProfile.getImage(i);
                if (fs.realpathSync(img['path']) === realpath) {
                    $('.active').removeClass('active');
                    $(`#image-${i}`).addClass('active');
                    return;
                }
            }
        }
    }
    $('#transparent-sticker').addClass('active');
}

/**
 * @param {DragStartEvent} event
 */
function dragStartEvent(event) {
    if (filterActive) {
        return;
    }
    let id = event.data.source.getAttribute('id');
    dragFrom = $(`#${id} img`).data('index');
    dragOver = -1;
    draggedId = id;
    draggedAtAll = false;
}

/**
 * @param {DragOverEvent} event
 */
function dragOverEvent(event) {
    if (filterActive) {
        return;
    }
    try {
        let id = event.over.getAttribute('id');
        let temp = $(`#${id} img`).data('index');
        let mirrorId = $('.draggable--over').attr('id');
        if (draggedId === mirrorId) {
            dragOver = -1;
            return;
        }
        if (temp !== dragFrom) {
            dragOver = temp;
            draggedAtAll = true;
        }
        // myConsole.log({"from": dragFrom, "to": dragOver, "tmp": temp});
    } catch(e) {
        myConsole.log(e);
    }
}

/**
 * @param {DragStopEvent} event
 */
function dragStopEvent(event) {
    if (filterActive) {
        return;
    }
    if (!draggedAtAll) {
        let target = $(`#image-${dragFrom}-container`);
        selectImage(target.find("img").data("path"));
        ipc.send('unsaved-changes', true);
        setTimeout(() => {return redrawImages(true);}, 1);
        return;
    }
    if (typeof dragOver === 'undefined') {
        return;
    }
    if (dragOver < 0) {
        return;
    }
    if (dragOver === dragFrom) {
        return;
    }
    // myConsole.log({"from": dragFrom, "to": dragOver});
    activeProfile.moveImage(dragFrom, dragOver);
    ipc.send('unsaved-changes', true);
    dragOver = -1;
    dragFrom = -1;
    setTimeout(() => {return redrawImages(true);}, 1);
}

/**
 * Prevent apostrophes from being injected in URLs;
 *
 * @param {string} str
 * @returns {string}
 */
function escapeImagePath(str) {
    return str.split("'").join("%27");
}

/**
 * Filter stickers based on tags being shown.
 */
function filterByTags() {
    let tagString = $("#tag-filter").val();
    let tags = tagString.split(',');
    if (tags.length === 0) {
        filterActive = false;
        $('.sticker').show();
        return;
    }
    if (tags.length < 2) {
        if (tags[0].trim() === '') {
            filterActive = false;
            $('.sticker').show();
            return;
        }
    }
    filterActive = true;

    let selectedTag = '';
    let indices = [];
    let image;
    for (let i = 0; i < activeProfile.getImageCount(); i++) {
        image = activeProfile.getImage(i);
        for (let j = 0; j < tags.length; j++) {
            selectedTag = tags[j].trim();
            if (typeof(image.tags) === 'undefined') {
                break;
            }
            if (image.tags.includes(selectedTag)) {
                indices.push(i);
                break;
            }
        }
    }
    $('.real-sticker').hide(0);
    let n;
    for (let i = 0; i < indices.length; i++) {
        n = indices[i];
        // myConsole.log(n);
        $(`#image-${  n  }-container`).show(0);
    }
}

/**
 * Called by the main process when the user presses
 * File > New Profile
 */
function menuNewProfile() {
    activeProfile = Stickers.defaultProfile();
    activeProfilePath = "";
    $(document).attr('title', 'New Profile' + " - Fursona Sticker Switcher");
    $('#symlink-path').val(activeProfile.getSymlink());
    redrawImages();
    setTimeout(function() {
        $('.active').removeClass('active');
        $('#transparent-sticker').addClass('active');
    }, 1);
    ipc.send('unsaved-changes', true);
}

/**
 * Called by the main process when the user presses
 * File > Load Profile
 */
function menuLoadProfile() {
    // Open a file dialog
    let file = dialog.showOpenDialog();
    if (typeof file === 'undefined') {
        return;
    }
    if (file === null) {
        return;
    }
    if (file.length < 1) {
        return;
    }
    loadProfile(file[0]);
}

/**
 * Actually load the file.
 *
 * @param {string} file
 */
async function loadProfile(file) {
    // Load the profile from the given JSON file
    if (!(typeof file === 'string')) {
        throw new TypeError('Empty file');
    }
    try {
        activeProfile = await Stickers.loadFromProfile(file);
        $(document).attr('title', `${activeProfile.getName()} - Fursona Sticker Switcher`);
        activeProfilePath = file;
        config.set("lastProfile", activeProfilePath);
        config.save();
        $('#symlink-path').val(activeProfile.getSymlink());
        redrawImages(true);
        ipc.send('unsaved-changes', false);
    } catch (e) {
        myConsole.log(e);
        throw e;
    }
}

/**
 * Called by the main process when the user presses
 * File > Save Profile
 */
function menuSaveProfile() {
    // If path is unspecified, open a file dialog
    // Save the profile to the path specified
    if (activeProfile.getName() === "") {
        prompt({
            "name": "Profile Name?",
            "label": "Please enter a profile name:",
            "value": ""
        }).then(function (r) {
            try {
                activeProfile.setName(r);
                $(document).attr('title', `${r} - Fursona Sticker Switcher`);
                if (activeProfilePath === "") {
                    return menuSaveProfileAs();
                }
                return menuSaveFileCallback();
            } catch (e) {
                myConsole.log(e);
            }
        });
    } else {
        if (activeProfilePath === "") {
            return menuSaveProfileAs();
        }
        return menuSaveFileCallback();
    }
}

/**
 * Callback function for the Save Profile menu options.
 */
function menuSaveFileCallback() {
    config.set("lastProfile", activeProfilePath);
    config.save();
    ipc.send('unsaved-changes', false);
    fs.writeFile(
        activeProfilePath,
        JSON.stringify({
            "version": activeProfile.getVersion(),
            "name": activeProfile.getName(),
            "symlink": activeProfile.getSymlink(),
            "images": activeProfile.getAllImages()
        }),
        () => {}
    );
}


/**
 * Called by the main process when the user presses
 * File > Save Profile As
 */
function menuSaveProfileAs() {
    // Open a file dialog
    let oldValue = activeProfilePath;
    activeProfilePath = dialog.showSaveDialog();
    if (typeof activeProfilePath === "undefined") {
        activeProfilePath = oldValue;
        return;
    }
    if (activeProfilePath === "") {
        activeProfilePath = oldValue;
        return;
    }

    return menuSaveFileCallback();
    // Save the profile to the path specified
}


/**
 * Called by the main process when the user presses
 * File > Add Photo
 */
function menuAddPhoto() {
    // Open a file dialog
    let files = dialog.showOpenDialog({"properties": ['multiSelections']});
    if (typeof files === 'undefined') {
        return;
    }
    if (files.length < 1) {
        return;
    }

    // Append a photo
    for (let i = 0; i < files.length; i++) {
        let newImage = {"path": files[i], "tags": []};
        activeProfile.appendImage(newImage);
        appendImage(newImage, i);
    }
    $('.sticker').on('click', stickerOnClickEvent);
    ipc.send('unsaved-changes', true);
}


/**
 * Clears and redraws all of the images in the active profile.
 */
function redrawImages(detect = false) {
    // Iterate through activeProfile.getImages(), call appendImage()
    $('#sticker-container').html(
        renderTransparentImage()
    );

    for (let i = 0; i < activeProfile.getImageCount(); i++) {
        appendImage(activeProfile.getImage(i), i);
    }
    $('.sticker').on('click', stickerOnClickEvent);
    if (detect) {
        setTimeout(detectActiveSymlink, 1);
    }
}

/**
 * The transparent image is special.
 *
 * @returns {string}
 */
function renderTransparentImage() {
    return "<div class=\"sticker\" id=\"transparent-sticker-container\">" +
        "<img " +
            "id='transparent-sticker' " +
            "class='transparent' " +
            "alt='Click to not choose a sticker' " +
            "data-index='-1' " +
            "data-path='' " +
            "src='transparent.png' " +
        "/>" +
        "</div>";
}

/**
 * Return the HTML for rendering an image.
 *
 * @param {object} imageObject
 * @param {int} index
 * @returns {string}
 */
function renderImagePreview(imageObject, index = 0) {
    return `<div class="sticker real-sticker draggable-source" id="image-${index}-container">` +
        `<img ` +
            `id='image-${index}' ` +
            `title='image-${index}' ` +
            `alt='Click to choose sticker' ` +
            `data-index='${index}' ` +
            `data-path='${escapeImagePath(imageObject.path)}' ` +
            `src='file://${escapeImagePath(imageObject.path)}' ` +
        `/>` +
        `</div>`;
}

/**
 * Select the image for display on stream.
 *
 * @param {string} activeImage
 */
function selectImage(activeImage) {
    try {
        // Change symlink to file
        if (fs.existsSync(activeProfile.getSymlink())) {
            fs.unlinkSync(activeProfile.getSymlink());
        }
        if (activeImage === "") {
            return;
        }
        if (process.platform === "win32") {
            /*
             On Windows, if you don't have permission to create a symlink
             (i.e. you're not running this as Administrator), we have to
             delete and copy the file instead. This is much slower, but it
             serves the same purpose.
             */
            if (isWindowsAdmin) {
                return fs.symlink(activeImage, activeProfile.getSymlink(), ()=>{
                    changeTime(activeImage);
                    changeTime(activeProfile.getSymlink());
                });
            } else {
                return fs.copyFile(
                    activeImage,
                    activeProfile.getSymlink(),
                    function () {
                        changeTime(activeImage);
                        changeTime(activeProfile.getSymlink());
                    }
                );
            }
        } else {
            return fs.symlink(activeImage, activeProfile.getSymlink(), ()=>{
                changeTime(activeImage);
                changeTime(activeProfile.getSymlink());
            });
        }
    } catch (e) {
        myConsole.log(e);
    }
}

function updateTags(args) {
    let id = args['id'];
    let expectedPath = args['path'];
    let tags = args['tags'];

    let image = activeProfile.getImage(id);
    if (image.path !== expectedPath) {
        throw new Error(
            `Expected path and path do not match: ${image.path}, ${expectedPath}`
        );
    }
    activeProfile.setImageTags(id, tags);
}

/**
 * OnClick event handler for each sticker.
 */
function stickerOnClickEvent() {
    $(".active").removeClass("active");
    $(this).addClass("active");
    return selectImage($(this).find("img").data("path"));
}

/**
 * Handle menu events from main.js and pass them to their relevant
 * functions.
 *
 * Uses a strict allow list to ensure main.js cannot call arbitrary functions.
 */
ipc.on('parentFunc', (event, data) => {
    switch (data) {
        case "menuNewProfile":
            return menuNewProfile();
        case "menuLoadProfile":
            return menuLoadProfile();
        case "menuSaveProfile":
            return menuSaveProfile();
        case "menuSaveProfileAs":
            return menuSaveProfileAs();
        case "menuAddPhoto":
            return menuAddPhoto();
        default:
            throw new Error("Function not allowed");
    }
});

ipc.on('editTagComplete', (event, data) => {
    updateTags(data);
});
ipc.on('import-complete', (event, data) => {
    setTimeout(redrawImages, 1);
});

ipc.on('telegram-imported-sticker', (event, data) => {
    let newIndex = activeProfile.getImageCount();
    let imageObject = {
        "path": data.path,
        "tags": [data.packName]
    };
    activeProfile.appendImage(imageObject);
    ipc.send('unsaved-changes', true);
    appendImage(imageObject, newIndex);
});

/**
 * Startup functions
 */
$(document).ready(function() {
    config = Settings.load('./settings.json');
    loadProfile(config.get('lastProfile'))
        .catch(function(e){
            if (e.message !== 'Empty file') {
                myConsole.log(e);
            }
            menuNewProfile();
        }).then(function() {
            redrawImages(true);
            if (process.platform === "win32") {
                let exec = require('child_process').exec;
                exec('NET SESSION', function (err, so, se) {
                    isWindowsAdmin = se.length === 0;
                });
            }
            $("#symlink-path").on('change', function () {
                activeProfile.setSymlinkPath($(this).val());
            });
            $("#tag-filter").on('change', function() {
                try {
                    filterByTags();
                } catch (e) {
                    myConsole.log(e);
                }
            });
            try {
                dragDrop = new Sortable(
                    document.getElementById('sticker-container')
                );
                dragDrop.on('drag:start', dragStartEvent);
                dragDrop.on('drag:over', dragOverEvent);
                dragDrop.on('drag:stop', dragStopEvent);
            } catch (e) {
                myConsole.log(e);
                return;
            }

            const imageMenu = new Menu();
            imageMenu.append(
                new MenuItem(
                    {
                        label: 'Remove Sticker',
                        click() {
                            return contextMenuRemove();
                        }
                    }
                )
            );
            imageMenu.append(
                new MenuItem(
                    {
                        label: 'Edit Tags',
                        click() {
                            return contextMenuEditTags();
                        }
                    }
                )
            );

            /**
             * Attaches the right menu to #sticker-container.
             */
            document
                .getElementById('sticker-container')
                .addEventListener(
                    'contextmenu',
                    (e) => {
                        contextMenuTarget = e.target;
                        e.preventDefault();
                        imageMenu.popup({window: remote.getCurrentWindow()})
                    },
                    false
                );

            /**
             * Prevent the default behavior.
             */
            document.ondragover = document.ondrop = (ev) => {
                ev.preventDefault();
            };

            /**
             * The ondrop handler allows us to add image files when they are
             * dragged and dropped from outside the app. In our case, we simply
             * iterate through them and add them to the current profile.
             */
            document.body.ondrop = (ev) => {
                let newImage, newIndex;
                newIndex = activeProfile.getImageCount();
                for (let i = 0; i < ev.dataTransfer.files.length; i++) {
                    newImage = {"path": ev.dataTransfer.files[i].path, "tags": []};
                    activeProfile.appendImage(newImage);
                    appendImage(newImage, (newIndex + i));
                }
            };
        });
});
