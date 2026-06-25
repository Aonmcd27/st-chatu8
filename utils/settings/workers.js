export const json = `{
    "2": {
      "inputs": {
        "stop_at_clip_layer": -2,
        "clip": [
          "20",
          1
        ]
      },
      "class_type": "CLIPSetLastLayer",
      "_meta": {
        "title": "CLIP设置停止层"
      }
    },
    "5": {
      "inputs": {
        "seed": "%seed%",
        "steps": "%steps%",
        "cfg": "%cfg_scale%",
        "sampler_name": "%sampler_name%",
        "scheduler": "%scheduler%",
        "denoise": 1,
        "model": [
          "158",
          0
        ],
        "positive": [
          "158",
          1
        ],
        "negative": [
          "59",
          0
        ],
        "latent_image": [
          "6",
          0
        ]
      },
      "class_type": "KSampler",
      "_meta": {
        "title": "K采样器"
      }
    },
    "6": {
      "inputs": {
        "width": "%width%",
        "height": "%height%",
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage",
      "_meta": {
        "title": "空Latent"
      }
    },
    "20": {
      "inputs": {
        "ckpt_name": "%MODEL_NAME%"
      },
      "class_type": "CheckpointLoaderSimple",
      "_meta": {
        "title": "Checkpoint加载器(简易)"
      }
    },
    "31": {
      "inputs": {
        "samples": [
          "5",
          0
        ],
        "vae": [
          "20",
          2
        ]
      },
      "class_type": "VAEDecode",
      "_meta": {
        "title": "VAE解码"
      }
    },
    "59": {
      "inputs": {
        "text": "%negative_prompt%",
        "speak_and_recognation": true,
        "clip": [
          "2",
          0
        ]
      },
      "class_type": "CLIPTextEncode",
      "_meta": {
        "title": "CLIP文本编码器"
      }
    },
    "122": {
      "inputs": {
        "filename_prefix": "lowres_MANGURI",
        "images": [
          "31",
          0
        ]
      },
      "class_type": "SaveImage",
      "_meta": {
        "title": "保存图像"
      }
    },
    "158": {
      "inputs": {
        "positive": "%prompt%",
        "打开可视化PromptUI": "",
        "speak_and_recognation": true,
        "model": [
          "20",
          0
        ],
        "clip": [
          "2",
          0
        ]
      },
      "class_type": "WeiLinComfyUIPromptToLorasOnly",
      "_meta": {
        "title": "WeiLin 正向提示词Lora自动加载"
      }
    }
  }`;

export const json2 = `{
    "3": {
      "inputs": {
        "seed": "%seed%",
        "steps": "%steps%",
        "cfg": "%cfg_scale%",
        "sampler_name": "%sampler_name%",
        "scheduler": "%scheduler%",
        "denoise": 1,
        "model": [
          "15",
          0
        ],
        "positive": [
          "20",
          1
        ],
        "negative": [
          "7",
          0
        ],
        "latent_image": [
          "19",
          0
        ]
      },
      "class_type": "KSampler",
      "_meta": {
        "title": "K采样器"
      }
    },
    "4": {
      "inputs": {
        "ckpt_name": "%MODEL_NAME%"
      },
      "class_type": "CheckpointLoaderSimple",
      "_meta": {
        "title": "Checkpoint加载器(简易)"
      }
    },
    "7": {
      "inputs": {
        "text": "%negative_prompt%",
        "speak_and_recognation": true,
        "clip": [
          "4",
          1
        ]
      },
      "class_type": "CLIPTextEncode",
      "_meta": {
        "title": "CLIP文本编码器"
      }
    },
    "8": {
      "inputs": {
        "samples": [
          "3",
          0
        ],
        "vae": [
          "4",
          2
        ]
      },
      "class_type": "VAEDecode",
      "_meta": {
        "title": "VAE解码"
      }
    },
    "23": {
      "inputs": {
        "filename_prefix": "ComfyUI",
        "images": [
          "8",
          0
        ]
      },
      "class_type": "SaveImage",
      "_meta": {
        "title": "保存图像"
      }
    },
    "13": {
      "inputs": {
        "preset": "%ipa%",
        "model": [
          "20",
          0
        ]
      },
      "class_type": "IPAdapterUnifiedLoader",
      "_meta": {
        "title": "IPAdapter加载器"
      }
    },
    "14": {
      "inputs": {
        "image": "%comfyuicankaotupian%",
        "upload": "image"
      },
      "class_type": "LoadImage",
      "_meta": {
        "title": "加载图像"
      }
    },
    "15": {
      "inputs": {
        "weight": "%c_quanzhong%",
        "weight_faceidv2": "%c_idquanzhong%",
        "weight_type": "style and composition",
        "combine_embeds": "concat",
        "start_at": 0,
        "end_at": 1,
        "embeds_scaling": "K+mean(V) w/ C penalty",
        "layer_weights": "0:0, 1:0, 2:0, 3:"%c_xijie%", 4:0, 5:0, 6:"%c_fenwei%", 7:0, 8:0, 9:0, 10:0",
        "speak_and_recognation": true,
        "model": [
          "13",
          0
        ],
        "ipadapter": [
          "13",
          1
        ],
        "image": [
          "14",
          0
        ]
      },
      "class_type": "IPAdapterMS",
      "_meta": {
        "title": "应用IPAdapter Mad Scientist"
      }
    },
    "19": {
      "inputs": {
        "width": "%width%",
        "height": "%height%",
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage",
      "_meta": {
        "title": "空Latent"
      }
    },
    "20": {
      "inputs": {
        "positive": "%prompt%",
        "打开可视化PromptUI": "",
        "speak_and_recognation": true,
        "model": [
          "4",
          0
        ],
        "clip": [
          "4",
          1
        ]
      },
      "class_type": "WeiLinComfyUIPromptToLorasOnly",
      "_meta": {
        "title": "WeiLin 正向提示词Lora自动加载"
      }
    }
  }`;

export const json3 = `{
      "3": {
      "inputs": {
        "seed": "%seed%",
        "steps": "%steps%",
        "cfg": "%cfg_scale%",
        "sampler_name": "%sampler_name%",
        "scheduler": "%scheduler%",
        "denoise": 1,
        "model": [
          "39",
            0
          ],
          "positive": [
            "39",
            1
          ],
          "negative": [
            "7",
            0
          ],
          "latent_image": [
            "5",
            0
          ]
        },
        "class_type": "KSampler",
        "_meta": {
          "title": "K采样器"
        }
      },
      "5": {
        "inputs": {
          "width": "%width%",
          "height": "%height%",
          "batch_size": 1
        },
        "class_type": "EmptyLatentImage",
        "_meta": {
          "title": "空Latent"
        }
      },
      "7": {
        "inputs": {
          "text": "%negative_prompt%",
          "speak_and_recognation": true,
          "clip": [
            "14",
            1
          ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
          "title": "CLIP文本编码器"
        }
      },
      "8": {
        "inputs": {
          "samples": [
            "3",
            0
          ],
          "vae": [
            "14",
            2
          ]
        },
        "class_type": "VAEDecode",
        "_meta": {
          "title": "VAE解码"
        }
      },
      "14": {
        "inputs": {
          "ckpt_name": "%MODEL_NAME%"
        },
        "class_type": "CheckpointLoaderSimple",
        "_meta": {
          "title": "Checkpoint加载器(简易)"
        }
      },
      "23": {
        "inputs": {
          "model_name": "bbox/face_yolov8m.pt"
        },
        "class_type": "UltralyticsDetectorProvider",
        "_meta": {
          "title": "检测加载器"
        }
      },
      "25": {
        "inputs": {
          "model_name": "sam_vit_b_01ec64.pth",
          "device_mode": "AUTO"
        },
        "class_type": "SAMLoader",
        "_meta": {
          "title": "SAM加载器"
        }
      },
      "26": {
        "inputs": {
          "model_name": "segm/person_yolov8m-seg.pt"
        },
        "class_type": "UltralyticsDetectorProvider",
        "_meta": {
          "title": "检测加载器"
        }
      },
      "30": {
        "inputs": {
          "filename_prefix": "ComfyUI",
          "images": [
            "35",
            0
          ]
        },
        "class_type": "SaveImage",
        "_meta": {
          "title": "保存图像"
        }
      },
      "35": {
        "inputs": {
          "guide_size": 512,
          "guide_size_for": true,
          "max_size": 1024,
          "seed": "%seed%",
          "steps": "%steps%",
          "cfg": "%cfg_scale%",
          "sampler_name": "%sampler_name%",
          "scheduler": "%scheduler%",
          "denoise": 0.5,
          "feather": 5,
          "noise_mask": true,
          "force_inpaint": true,
          "bbox_threshold": 0.5,
          "bbox_dilation": 10,
          "bbox_crop_factor": 3,
          "sam_detection_hint": "center-1",
          "sam_dilation": 0,
          "sam_threshold": 0.93,
          "sam_bbox_expansion": 0,
          "sam_mask_hint_threshold": 0.7000000000000001,
          "sam_mask_hint_use_negative": "False",
          "drop_size": 10,
          "wildcard": "",
          "cycle": 1,
          "inpaint_model": false,
          "noise_mask_feather": 20,
          "speak_and_recognation": true,
          "image": [
            "8",
            0
          ],
          "model": [
            "39",
            0
          ],
          "clip": [
            "14",
            1
          ],
          "vae": [
            "14",
            2
          ],
          "positive": [
            "39",
            1
          ],
          "negative": [
            "7",
            0
          ],
          "bbox_detector": [
            "23",
            0
          ],
          "sam_model_opt": [
            "25",
            0
          ],
          "segm_detector_opt": [
            "26",
            1
          ]
        },
        "class_type": "FaceDetailer",
        "_meta": {
          "title": "面部细化"
        }
      },
      "39": {
        "inputs": {
          "positive": "%prompt%",
          "打开可视化PromptUI": "",
          "speak_and_recognation": true,
          "model": [
            "14",
            0
          ],
          "clip": [
            "14",
            1
          ]
        },
        "class_type": "WeiLinComfyUIPromptToLorasOnly",
        "_meta": {
          "title": "WeiLin 正向提示词Lora自动加载"
        }
    }
  }`;
export const editwk = `{
  "1": {
    "inputs": {
      "ckpt_name": "%MODEL_NAME%"
    },
    "class_type": "CheckpointLoaderSimple",
    "_meta": {
      "title": "Checkpoint加载器（简易）"
    }
  },
  "2": {
    "inputs": {
      "text": "%inpaint_positive%",
      "speak_and_recognation": {
        "__value__": [
          false,
          true
        ]
      },
      "clip": [
        "1",
        1
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码"
    }
  },
  "3": {
    "inputs": {
      "text": "%inpaint_negative%",
      "speak_and_recognation": {
        "__value__": [
          false,
          true
        ]
      },
      "clip": [
        "1",
        1
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP文本编码"
    }
  },
  "4": {
    "inputs": {
      "image": "%inpaint_image%"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "加载图像"
    }
  },
  "5": {
    "inputs": {
      "pixels": [
        "4",
        0
      ],
      "vae": [
        "1",
        2
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE编码"
    }
  },
  "6": {
    "inputs": {
      "samples": [
        "5",
        0
      ],
      "mask": [
        "14",
        0
      ]
    },
    "class_type": "SetLatentNoiseMask",
    "_meta": {
      "title": "设置Latent噪波遮罩"
    }
  },
  "7": {
    "inputs": {
      "seed": 680566878009757,
      "steps": 28,
      "cfg": 8,
      "sampler_name": "dpmpp_2m",
      "scheduler": "normal",
      "denoise": "%inpaint_denoise%",
      "model": [
        "1",
        0
      ],
      "positive": [
        "2",
        0
      ],
      "negative": [
        "3",
        0
      ],
      "latent_image": [
        "6",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "K采样器"
    }
  },
  "8": {
    "inputs": {
      "samples": [
        "7",
        0
      ],
      "vae": [
        "1",
        2
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "9": {
    "inputs": {
      "filename_prefix": "ComfyUI_Inpaint",
      "images": [
        "8",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "保存图像"
    }
  },
  "11": {
    "inputs": {
      "samples": [
        "6",
        0
      ],
      "vae": [
        "1",
        2
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE解码"
    }
  },
  "12": {
    "inputs": {
      "images": [
        "11",
        0
      ]
    },
    "class_type": "PreviewImage",
    "_meta": {
      "title": "预览图像"
    }
  },
  "14": {
    "inputs": {
      "image": "%inpaint_mask%",
      "channel": "red"
    },
    "class_type": "LoadImageMask",
    "_meta": {
      "title": "加载图像（作为遮罩）"
    }
  }
}`;

export const jsonweldf = `{
    "3": {
      "inputs": {
        "seed": "%seed%",
        "steps": "%steps%",
        "cfg": "%cfg_scale%",
        "sampler_name": "%sampler_name%",
        "scheduler": "%scheduler%",
        "denoise": 1,
        "model": [
          "27",
          3
        ],
        "positive": [
          "27",
          1
        ],
        "negative": [
          "7",
          0
        ],
        "latent_image": [
          "19",
          0
        ]
      },
      "class_type": "KSampler",
      "_meta": {
        "title": "K采样器"
      }
    },
    "4": {
      "inputs": {
        "ckpt_name": "%MODEL_NAME%"
      },
      "class_type": "CheckpointLoaderSimple",
      "_meta": {
        "title": "Checkpoint加载器(简易)"
      }
    },
    "7": {
      "inputs": {
        "text": "%negative_prompt%",
        "speak_and_recognation": true,
        "clip": [
          "27",
          2
        ]
      },
      "class_type": "CLIPTextEncode",
      "_meta": {
        "title": "CLIP文本编码器"
      }
    },
    "8": {
      "inputs": {
        "samples": [
          "3",
          0
        ],
        "vae": [
          "4",
          2
        ]
      },
      "class_type": "VAEDecode",
      "_meta": {
        "title": "VAE解码"
      }
    },
    "19": {
      "inputs": {
        "width": "%width%",
        "height": "%height%",
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage",
      "_meta": {
        "title": "空Latent"
      }
    },
    "23": {
      "inputs": {
        "filename_prefix": "ComfyUI",
        "images": [
          "8",
          0
        ]
      },
      "class_type": "SaveImage",
      "_meta": {
        "title": "保存图像"
      }
    },
    "27": {
      "inputs": {
        "positive": "%prompt%",
        "auto_random": false,
        "lora_str": "",
        "temp_str": "",
        "temp_lora_str": "",
        "random_template": "",
        "打开提示词编辑器": "",
        "打开Lora堆": "",
        "speak_and_recognation": {
          "__value__": [
            false,
            true
          ]
        },
        "opt_clip": [
          "4",
          1
        ],
        "opt_model": [
          "4",
          0
        ]
      },
      "class_type": "WeiLinPromptUI",
      "_meta": {
        "title": "WeiLin 全能提示词编辑器"
      }
    }
  }`

export const jsonweilinvae = `{
    "3": {
      "inputs": {
        "seed": "%seed%",
        "steps": "%steps%",
        "cfg": "%cfg_scale%",
        "sampler_name": "%sampler_name%",
        "scheduler": "%scheduler%",
        "denoise": 1,
        "model": [
          "27",
          3
        ],
        "positive": [
          "27",
          1
        ],
        "negative": [
          "7",
          0
        ],
        "latent_image": [
          "19",
          0
        ]
      },
      "class_type": "KSampler",
      "_meta": {
        "title": "K采样器"
      }
    },
    "4": {
      "inputs": {
        "ckpt_name": "%MODEL_NAME%"
      },
      "class_type": "CheckpointLoaderSimple",
      "_meta": {
        "title": "Checkpoint加载器(简易)"
      }
    },
    "7": {
      "inputs": {
        "text": "%negative_prompt%",
        "speak_and_recognation": true,
        "clip": [
          "27",
          2
        ]
      },
      "class_type": "CLIPTextEncode",
      "_meta": {
        "title": "CLIP文本编码器"
      }
    },
    "8": {
      "inputs": {
        "samples": [
          "3",
          0
        ],
        "vae": [
          "31",
          0
        ]
      },
      "class_type": "VAEDecode",
      "_meta": {
        "title": "VAE解码"
      }
    },
    "19": {
      "inputs": {
        "width": "%width%",
        "height": "%height%",
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage",
      "_meta": {
        "title": "空Latent"
      }
    },
    "23": {
      "inputs": {
        "filename_prefix": "ComfyUI",
        "images": [
          "8",
          0
        ]
      },
      "class_type": "SaveImage",
      "_meta": {
        "title": "保存图像"
      }
    },
    "27": {
      "inputs": {
        "positive": "%prompt%",
        "auto_random": false,
        "lora_str": "",
        "temp_str": "",
        "temp_lora_str": "",
        "random_template": "",
        "打开提示词编辑器": "",
        "打开Lora堆": "",
        "speak_and_recognation": {
          "__value__": [
            false,
            true
          ]
        },
        "opt_clip": [
          "4",
          1
        ],
        "opt_model": [
          "4",
          0
        ]
      },
      "class_type": "WeiLinPromptUI",
      "_meta": {
        "title": "WeiLin 全能提示词编辑器"
      }
    },
    "31": {
      "inputs": {
        "vae_name": "%vae%"
      },
      "class_type": "VAELoader",
      "_meta": {
        "title": "加载VAE"
      }
    }
  }`;

export const jsonvae = `{
    "3": {
      "inputs": {
        "seed": "%seed%",
        "steps": "%steps%",
        "cfg": "%cfg_scale%",
        "sampler_name": "%sampler_name%",
        "scheduler": "%scheduler%",
        "denoise": 1,
        "model": [
          "20",
          0
        ],
        "positive": [
          "20",
          1
        ],
        "negative": [
          "7",
          0
        ],
        "latent_image": [
          "19",
          0
        ]
      },
      "class_type": "KSampler",
      "_meta": {
        "title": "K采样器"
      }
    },
    "4": {
      "inputs": {
        "ckpt_name": "%MODEL_NAME%"
      },
      "class_type": "CheckpointLoaderSimple",
      "_meta": {
        "title": "Checkpoint加载器(简易)"
      }
    },
    "7": {
      "inputs": {
        "text": "%negative_prompt%",
        "speak_and_recognation": true,
        "clip": [
          "4",
          1
        ]
      },
      "class_type": "CLIPTextEncode",
      "_meta": {
        "title": "CLIP文本编码器"
      }
    },
    "8": {
      "inputs": {
        "samples": [
          "3",
          0
        ],
        "vae": [
          "25",
          0
        ]
      },
      "class_type": "VAEDecode",
      "_meta": {
        "title": "VAE解码"
      }
    },
    "19": {
      "inputs": {
        "width": "%width%",
        "height": "%height%",
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage",
      "_meta": {
        "title": "空Latent"
      }
    },
    "20": {
      "inputs": {
        "positive": "%prompt%",
        "打开可视化PromptUI": "",
        "speak_and_recognation": true,
        "model": [
          "4",
          0
        ],
        "clip": [
          "4",
          1
        ]
      },
      "class_type": "WeiLinComfyUIPromptToLorasOnly",
      "_meta": {
        "title": "WeiLin 正向提示词Lora自动加载"
      }
    },
    "23": {
      "inputs": {
        "filename_prefix": "ComfyUI",
        "images": [
          "8",
          0
        ]
      },
      "class_type": "SaveImage",
      "_meta": {
        "title": "保存图像"
      }
    },
    "25": {
      "inputs": {
        "vae_name": "%vae%"
      },
      "class_type": "VAELoader",
      "_meta": {
        "title": "加载VAE"
      }
    }
  }`;