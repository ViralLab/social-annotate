var DEFAULT_CONSENT = {
    "enabled": false,
    "text": "### Informed Consent for Research Participation\n\nBy continuing to use this annotation tool on **{platform}**, you agree to participate in our research study.\n\n**Purpose:** The purpose of this study is to understand social media interactions and content. You will be asked to annotate posts and profiles that appear in your feed.\n\n**Data Collection:** Your annotations, along with timestamps, your anonymized browser ID, and metadata related to the annotated posts will be collected and securely stored.\n\n**Voluntary Participation:** Your participation is strictly voluntary. You may stop participating at any time by simply disabling or uninstalling the extension. There are no risks or direct benefits associated with your participation.\n\n**Confidentiality:** All collected data will be kept strictly confidential and will only be used for academic and research purposes.\n\nBy checking the box below and clicking 'Approve', you acknowledge that you have read and understood this information, that you are 18 years of age or older, and that you voluntarily consent to participate."
};

var config = {
    "exportFormat": "jsonl",
    "apiEndpoint": "",  // e.g. http://127.0.0.1:5000/response
    "downloadFolder": "",  // replaces SocialAnnotateExports/ as root folder when set
    "activeSurveys": ["x-post"], // default to only x-post to prevent dual rendering
    "surveys": {
        "x-post": {
            "socialMediaPlatform": "x",
            "injectElement": {},  // tweets are detected dynamically via MutationObserver, not a fixed element
            "studyID": "x-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
            "studyID": "x-user-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
            "studyID": "instagram-user-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
            "studyID": "instagram-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
        "instagram-reel": {
            "socialMediaPlatform": "instagram",
            "injectElement": {},
            "studyID": "instagram-reel-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this reel contain HateSpeech?",
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
            "studyID": "bluesky-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
            "studyID": "bluesky-user-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
            "studyID": "whatsapp-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
            "studyID": "telegram-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
            "studyID": "truthsocial-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
            "studyID": "truthsocial-user-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
        "linkedin-post": {
            "socialMediaPlatform": "linkedin",
            "injectElement": {},
            "studyID": "linkedin-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
        "linkedin-user": {
            "socialMediaPlatform": "linkedin",
            "injectElement": {},
            "studyID": "linkedin-user-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this user spread HateSpeech?",
                        "enum": ["Yes", "No"],
                        "required": true
                    },
                    "confidence": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 10,
                        "title": "Confidence (0-10)"
                    }
                },
                "form": [
                    {
                        "key": "hatespeech",
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
        "mastodon-post": {
            "socialMediaPlatform": "mastodon",
            "injectElement": {},
            "studyID": "mastodon-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
        "mastodon-user": {
            "socialMediaPlatform": "mastodon",
            "injectElement": {
                "name": "mastodon",
                "type": "id",
                "index": 0
            },
            "studyID": "mastodon-user-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
        "youtube-video": {
            "socialMediaPlatform": "youtube",
            "injectElement": {},
            "studyID": "youtube-video-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this video contain HateSpeech?",
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
        "youtube-user": {
            "socialMediaPlatform": "youtube",
            "injectElement": {},
            "studyID": "youtube-user-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "bot": {
                        "type": "string",
                        "title": "Do you believe this channel to be a bot?",
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
        "facebook-user": {
            "socialMediaPlatform": "facebook",
            "injectElement": {},
            "studyID": "facebook-user-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
        "facebook-post": {
            "socialMediaPlatform": "facebook",
            "injectElement": {},
            "studyID": "facebook-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
        "tiktok-post": {
            "socialMediaPlatform": "tiktok",
            "injectElement": {},
            "studyID": "tiktok-post-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
            "screenNameList": [],
            "surveyFormSchema": {
                "schema": {
                    "hatespeech": {
                        "type": "string",
                        "title": "Does this video contain HateSpeech?",
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
        "tiktok-user": {
            "socialMediaPlatform": "tiktok",
            "injectElement": {},
            "studyID": "tiktok-user-study",
            "mediaDownloadFolder": "",
            "theme": "light",
            "informedConsent": DEFAULT_CONSENT,
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
