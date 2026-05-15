var config = {
    "exportFormat": "jsonl",
    "apiEndpoint": "",  // e.g. http://127.0.0.1:5000/response
    "activeSurveys": ["x-post"], // default to only x-post to prevent dual rendering
    "surveys": {
        "x-post": {
            "socialMediaPlatform": "x",
            "injectElement": {},  // tweets are detected dynamically via MutationObserver, not a fixed element
            "studyID": "kokone",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this text contain HateSpeech?",
                        "enum": ["Yes", "No"],
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "hatespeech",
                        "type": "radiobuttons"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        },
        "x-user": {
            "socialMediaPlatform": "x",
            "injectElement": {
                "name": "global-nav-inner",
                "type": "class",
                "index": 0
            },
            "studyID": "maruko",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "bot": {
                        "type": "string",
                        "title": "Do you believe this user to be a bot?",
                        "enum": ["Yes", "No"],
                        "required": true
                    },
                    "confidence": {
                        "type": "integer",
                        "title": "How confident with your response to bot question?",
                        "description": "0 for least and 5 for the most confident",
                        "default": 3,
                        "minimum": 0,
                        "maximum": 5,
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "bot",
                        "type": "radiobuttons"
                    },
                    {
                        "key": "confidence",
                        "type": "range"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        },
        "instagram-user": {
            "socialMediaPlatform": "instagram",
            "injectElement": {
                "name": "global-nav-inner",
                "type": "class",
                "index": 0
            },
            "studyID": "maruko",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "bot": {
                        "type": "string",
                        "title": "Do you believe this user to be a bot?",
                        "enum": ["Yes", "No"],
                        "required": true
                    },
                    "celebrity": {
                        "type": "string",
                        "title": "Is this a celebrity user?",
                        "enum": ["Yes", "No"],
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "bot",
                        "type": "radiobuttons",
                        "activeClass": "btn-success"
                    },
                    {
                        "key": "celebrity",
                        "type": "radiobuttons",
                        "activeClass": "btn-success"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        },
        "instagram-post": {
            "socialMediaPlatform": "instagram",
            "injectElement": {},
            "studyID": "kokone",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this post contain HateSpeech?",
                        "enum": ["Yes", "No"],
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "hatespeech",
                        "type": "radiobuttons"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        },
        "bluesky-post": {
            "socialMediaPlatform": "bluesky",
            "injectElement": {},
            "studyID": "kokone",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this post contain HateSpeech?",
                        "enum": ["Yes", "No"],
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "hatespeech",
                        "type": "radiobuttons"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        },
        "bluesky-user": {
            "socialMediaPlatform": "bluesky",
            "injectElement": {
                "name": "root",
                "type": "id",
                "index": 0
            },
            "studyID": "maruko",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "bot": {
                        "type": "string",
                        "title": "Do you believe this user to be a bot?",
                        "enum": ["Yes", "No"],
                        "required": true
                    },
                    "confidence": {
                        "type": "integer",
                        "title": "How confident with your response to bot question?",
                        "description": "0 for least and 5 for the most confident",
                        "default": 3,
                        "minimum": 0,
                        "maximum": 5,
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "bot",
                        "type": "radiobuttons"
                    },
                    {
                        "key": "confidence",
                        "type": "range"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        },
        "whatsapp-post": {
            "socialMediaPlatform": "whatsapp",
            "injectElement": {},
            "studyID": "kokone",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this message contain HateSpeech?",
                        "enum": ["Yes", "No"],
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "hatespeech",
                        "type": "radiobuttons"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        },
        "telegram-post": {
            "socialMediaPlatform": "telegram",
            "injectElement": {},
            "studyID": "kokone",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this message contain HateSpeech?",
                        "enum": ["Yes", "No"],
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "hatespeech",
                        "type": "radiobuttons"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        },
        "truthsocial-post": {
            "socialMediaPlatform": "truthsocial",
            "injectElement": {},
            "studyID": "kokone",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this post contain HateSpeech?",
                        "enum": ["Yes", "No"],
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "hatespeech",
                        "type": "radiobuttons"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        },
        "truthsocial-user": {
            "socialMediaPlatform": "truthsocial",
            "injectElement": {
                "name": "root",
                "type": "id",
                "index": 0
            },
            "studyID": "maruko",
            "mediaDownloadFolder": "",
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "bot": {
                        "type": "string",
                        "title": "Do you believe this user to be a bot?",
                        "enum": ["Yes", "No"],
                        "required": true
                    },
                    "confidence": {
                        "type": "integer",
                        "title": "How confident with your response to bot question?",
                        "description": "0 for least and 5 for the most confident",
                        "default": 3,
                        "minimum": 0,
                        "maximum": 5,
                        "required": true
                    }
                },
                "form": [
                    {
                        "key": "bot",
                        "type": "radiobuttons"
                    },
                    {
                        "key": "confidence",
                        "type": "range"
                    },
                    {
                        "type": "submit",
                        "title": "Submit",
                        "htmlClass": "surveySubmitBtn"
                    }
                ]
            }
        }
    }
};
