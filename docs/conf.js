module.exports = {
    "plugins": [],
    "recurseDepth": 10,
    "source": {
        "include": ["lib/client"],
        "exclude": [],
        "includePattern": ".+\\.js(doc|x)?$",
        "excludePattern": "(^|\\/|\\\\)_"
    },
    "sourceType": "module",
    "tags": {
        "allowUnknownTags": true,
        "dictionaries": ["jsdoc","closure"]
    },
    "templates": {
        "cleverLinks": false,
        "monospaceLinks": false
    },
    "opts": {
        "destination": "./docs/html",
        "recurse": true,
        "readme": "./docs/API_README.md"
    }
};