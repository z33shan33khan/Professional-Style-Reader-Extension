/* Ultra Pro Reader — Piper AI voices bridge.
   Runs the open-source Piper neural TTS engine (WASM, bundled locally with the
   extension) directly in the reader page. Voice models are fetched once from the
   free piper-voices library on Hugging Face and cached in the browser's Origin
   Private File System — after the first download they work fully offline. */
import { TtsSession, PATH_MAP, download, remove, stored } from "../vendor/piper/piper-tts-web.js";
import voicesStatic from "../vendor/piper/voices_static-D_OtJDHM.js";

/* WASM assets shipped inside the extension (MV3 forbids remote scripts).
   Paths are made absolute against the page URL so onnxruntime-web's dynamic
   import of the wasm glue resolves correctly. */
const ORT_BASE = new URL("vendor/ort/", location.href).href;
const WASM_PATHS = {
  onnxWasm: ORT_BASE,
  piperData: new URL("vendor/piper-wasm/piper_phonemize.data", location.href).href,
  piperWasm: new URL("vendor/piper-wasm/piper_phonemize.wasm", location.href).href
};

/* Full piper-voices catalogue - every voice and language available in the
   bundled library (parsed from voices_static). q = model quality. */
const VOICES = [
  { id: "en_GB-alan-medium", label: "Alan", lang: "en", langLabel: "English (GB)", sizeMB: 60, q: "medium", flag: "🇬🇧" },
  { id: "en_GB-alan-low", label: "Alan", lang: "en", langLabel: "English (GB)", sizeMB: 60, q: "low", flag: "🇬🇧" },
  { id: "en_GB-alba-medium", label: "Alba", lang: "en", langLabel: "English (GB)", sizeMB: 60, q: "medium", flag: "🇬🇧" },
  { id: "en_US-amy-medium", label: "Amy", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_US-amy-low", label: "Amy", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "low", flag: "🇺🇸" },
  { id: "en_US-arctic-medium", label: "Arctic", lang: "en", langLabel: "English (US)", sizeMB: 73, q: "medium", flag: "🇺🇸" },
  { id: "en_GB-aru-medium", label: "Aru", lang: "en", langLabel: "English (GB)", sizeMB: 73, q: "medium", flag: "🇬🇧" },
  { id: "en_US-bryce-medium", label: "Bryce", lang: "en", langLabel: "English (US)", sizeMB: 61, q: "medium", flag: "🇺🇸" },
  { id: "en_GB-cori-medium", label: "Cori", lang: "en", langLabel: "English (GB)", sizeMB: 61, q: "medium", flag: "🇬🇧" },
  { id: "en_GB-cori-high", label: "Cori", lang: "en", langLabel: "English (GB)", sizeMB: 109, q: "high", flag: "🇬🇧" },
  { id: "en_US-danny-low", label: "Danny", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "low", flag: "🇺🇸" },
  { id: "en_US-hfc_female-medium", label: "Hfc Female", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_US-hfc_male-medium", label: "Hfc Male", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_GB-jenny_dioco-medium", label: "Jenny Dioco", lang: "en", langLabel: "English (GB)", sizeMB: 60, q: "medium", flag: "🇬🇧" },
  { id: "en_US-joe-medium", label: "Joe", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_US-john-medium", label: "John", lang: "en", langLabel: "English (US)", sizeMB: 61, q: "medium", flag: "🇺🇸" },
  { id: "en_US-kathleen-low", label: "Kathleen", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "low", flag: "🇺🇸" },
  { id: "en_US-kristin-medium", label: "Kristin", lang: "en", langLabel: "English (US)", sizeMB: 61, q: "medium", flag: "🇺🇸" },
  { id: "en_US-kusal-medium", label: "Kusal", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_US-l2arctic-medium", label: "L2arctic", lang: "en", langLabel: "English (US)", sizeMB: 73, q: "medium", flag: "🇺🇸" },
  { id: "en_US-lessac-medium", label: "Lessac", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_US-lessac-low", label: "Lessac", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "low", flag: "🇺🇸" },
  { id: "en_US-lessac-high", label: "Lessac", lang: "en", langLabel: "English (US)", sizeMB: 109, q: "high", flag: "🇺🇸" },
  { id: "en_US-libritts-high", label: "Libritts", lang: "en", langLabel: "English (US)", sizeMB: 130, q: "high", flag: "🇺🇸" },
  { id: "en_US-libritts_r-medium", label: "Libritts R", lang: "en", langLabel: "English (US)", sizeMB: 75, q: "medium", flag: "🇺🇸" },
  { id: "en_US-ljspeech-medium", label: "Ljspeech", lang: "en", langLabel: "English (US)", sizeMB: 61, q: "medium", flag: "🇺🇸" },
  { id: "en_US-ljspeech-high", label: "Ljspeech", lang: "en", langLabel: "English (US)", sizeMB: 109, q: "high", flag: "🇺🇸" },
  { id: "en_US-norman-medium", label: "Norman", lang: "en", langLabel: "English (US)", sizeMB: 61, q: "medium", flag: "🇺🇸" },
  { id: "en_GB-northern_english_male-medium", label: "Northern English Male", lang: "en", langLabel: "English (GB)", sizeMB: 60, q: "medium", flag: "🇬🇧" },
  { id: "en_US-ryan-high", label: "Ryan", lang: "en", langLabel: "English (US)", sizeMB: 115, q: "high", flag: "🇺🇸" },
  { id: "en_US-ryan-low", label: "Ryan", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "low", flag: "🇺🇸" },
  { id: "en_US-ryan-medium", label: "Ryan", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_GB-semaine-medium", label: "Semaine", lang: "en", langLabel: "English (GB)", sizeMB: 73, q: "medium", flag: "🇬🇧" },
  { id: "en_GB-southern_english_female-low", label: "Southern English Female", lang: "en", langLabel: "English (GB)", sizeMB: 60, q: "low", flag: "🇬🇧" },
  { id: "en_GB-vctk-medium", label: "Vctk", lang: "en", langLabel: "English (GB)", sizeMB: 73, q: "medium", flag: "🇬🇧" },
  { id: "en_US-hifi_tts_92-medium", label: "Hifi Tts 92", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_US-kathleen-medium", label: "Kathleen", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_US-mike-medium", label: "Mike", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "en_US-reza_ibrahim-medium", label: "Reza Ibrahim", lang: "en", langLabel: "English (US)", sizeMB: 61, q: "medium", flag: "🇺🇸" },
  { id: "en_US-sam-medium", label: "Sam", lang: "en", langLabel: "English (US)", sizeMB: 60, q: "medium", flag: "🇺🇸" },
  { id: "ar_JO-kareem-low", label: "Kareem", lang: "ar", langLabel: "Arabic (JO)", sizeMB: 60, q: "low", flag: "🇯🇴" },
  { id: "ar_JO-kareem-medium", label: "Kareem", lang: "ar", langLabel: "Arabic (JO)", sizeMB: 60, q: "medium", flag: "🇯🇴" },
  { id: "zh_CN-xiao_ya-medium", label: "Xiao Ya", lang: "zh", langLabel: "Chinese (CN)", sizeMB: 60, q: "medium", flag: "🇨🇳" },
  { id: "ca_ES-upc_ona-x_low", label: "Upc Ona", lang: "ca", langLabel: "Catalan (ES)", sizeMB: 20, q: "x-low", flag: "🇪🇸" },
  { id: "ca_ES-upc_ona-medium", label: "Upc Ona", lang: "ca", langLabel: "Catalan (ES)", sizeMB: 60, q: "medium", flag: "🇪🇸" },
  { id: "ca_ES-upc_pau-x_low", label: "Upc Pau", lang: "ca", langLabel: "Catalan (ES)", sizeMB: 27, q: "x-low", flag: "🇪🇸" },
  { id: "zh_CN-huayan-medium", label: "Huayan", lang: "zh", langLabel: "Chinese (CN)", sizeMB: 60, q: "medium", flag: "🇨🇳" },
  { id: "zh_CN-huayan-x_low", label: "Huayan", lang: "zh", langLabel: "Chinese (CN)", sizeMB: 20, q: "x-low", flag: "🇨🇳" },
  { id: "cs_CZ-kasandra-medium", label: "Kasandra", lang: "cs", langLabel: "Czech (CZ)", sizeMB: 61, q: "medium", flag: "🇨🇿" },
  { id: "zh_CN-chaowen-medium", label: "Chaowen", lang: "zh", langLabel: "Chinese (CN)", sizeMB: 60, q: "medium", flag: "🇨🇳" },
  { id: "cs_CZ-jirka-medium", label: "Jirka", lang: "cs", langLabel: "Czech (CZ)", sizeMB: 60, q: "medium", flag: "🇨🇿" },
  { id: "cs_CZ-jirka-low", label: "Jirka", lang: "cs", langLabel: "Czech (CZ)", sizeMB: 60, q: "low", flag: "🇨🇿" },
  { id: "da_DK-talesyntese-medium", label: "Talesyntese", lang: "da", langLabel: "Danish (DK)", sizeMB: 60, q: "medium", flag: "🇩🇰" },
  { id: "nl_NL-mls-medium", label: "Mls", lang: "nl", langLabel: "Dutch (NL)", sizeMB: 73, q: "medium", flag: "🇳🇱" },
  { id: "nl_NL-mls_5809-low", label: "Mls 5809", lang: "nl", langLabel: "Dutch (NL)", sizeMB: 60, q: "low", flag: "🇳🇱" },
  { id: "nl_NL-mls_7432-low", label: "Mls 7432", lang: "nl", langLabel: "Dutch (NL)", sizeMB: 60, q: "low", flag: "🇳🇱" },
  { id: "nl_NL-ronnie-medium", label: "Ronnie", lang: "nl", langLabel: "Dutch (NL)", sizeMB: 60, q: "medium", flag: "🇳🇱" },
  { id: "nl_NL-pim-medium", label: "Pim", lang: "nl", langLabel: "Dutch (NL)", sizeMB: 60, q: "medium", flag: "🇳🇱" },
  { id: "fa_IR-reza_ibrahim-medium", label: "Reza Ibrahim", lang: "fa", langLabel: "Farsi (IR)", sizeMB: 61, q: "medium", flag: "🇮🇷" },
  { id: "nl_BE-nathalie-medium", label: "Nathalie", lang: "nl", langLabel: "Dutch (BE)", sizeMB: 60, q: "medium", flag: "🇧🇪" },
  { id: "nl_BE-nathalie-x_low", label: "Nathalie", lang: "nl", langLabel: "Dutch (BE)", sizeMB: 20, q: "x-low", flag: "🇧🇪" },
  { id: "nl_BE-rdh-x_low", label: "Rdh", lang: "nl", langLabel: "Dutch (BE)", sizeMB: 20, q: "x-low", flag: "🇧🇪" },
  { id: "nl_BE-flemishguy-medium", label: "Flemishguy", lang: "nl", langLabel: "Dutch (BE)", sizeMB: 60, q: "medium", flag: "🇧🇪" },
  { id: "fa_IR-ganji-medium", label: "Ganji", lang: "fa", langLabel: "Farsi (IR)", sizeMB: 61, q: "medium", flag: "🇮🇷" },
  { id: "fa_IR-ganji_adabi-medium", label: "Ganji Adabi", lang: "fa", langLabel: "Farsi (IR)", sizeMB: 61, q: "medium", flag: "🇮🇷" },
  { id: "nl_BE-rdh-medium", label: "Rdh", lang: "nl", langLabel: "Dutch (BE)", sizeMB: 60, q: "medium", flag: "🇧🇪" },
  { id: "nl_NL-alex-medium", label: "Alex", lang: "nl", langLabel: "Dutch (NL)", sizeMB: 60, q: "medium", flag: "🇳🇱" },
  { id: "fa_IR-amir-medium", label: "Amir", lang: "fa", langLabel: "Farsi (IR)", sizeMB: 61, q: "medium", flag: "🇮🇷" },
  { id: "fa_IR-gyro-medium", label: "Gyro", lang: "fa", langLabel: "Farsi (IR)", sizeMB: 60, q: "medium", flag: "🇮🇷" },
  { id: "fi_FI-harri-low", label: "Harri", lang: "fi", langLabel: "Finnish (FI)", sizeMB: 67, q: "low", flag: "🇫🇮" },
  { id: "fi_FI-harri-medium", label: "Harri", lang: "fi", langLabel: "Finnish (FI)", sizeMB: 60, q: "medium", flag: "🇫🇮" },
  { id: "fr_FR-gilles-low", label: "Gilles", lang: "fr", langLabel: "French (FR)", sizeMB: 60, q: "low", flag: "🇫🇷" },
  { id: "fr_FR-mls-medium", label: "Mls", lang: "fr", langLabel: "French (FR)", sizeMB: 73, q: "medium", flag: "🇫🇷" },
  { id: "fr_FR-mls_1840-low", label: "Mls 1840", lang: "fr", langLabel: "French (FR)", sizeMB: 60, q: "low", flag: "🇫🇷" },
  { id: "fr_FR-siwis-low", label: "Siwis", lang: "fr", langLabel: "French (FR)", sizeMB: 27, q: "low", flag: "🇫🇷" },
  { id: "fr_FR-siwis-medium", label: "Siwis", lang: "fr", langLabel: "French (FR)", sizeMB: 60, q: "medium", flag: "🇫🇷" },
  { id: "fr_FR-tom-medium", label: "Tom", lang: "fr", langLabel: "French (FR)", sizeMB: 61, q: "medium", flag: "🇫🇷" },
  { id: "fr_FR-upmc-medium", label: "Upmc", lang: "fr", langLabel: "French (FR)", sizeMB: 73, q: "medium", flag: "🇫🇷" },
  { id: "ka_GE-natia-medium", label: "Natia", lang: "ka", langLabel: "Georgian (GE)", sizeMB: 60, q: "medium", flag: "🇬🇪" },
  { id: "de_DE-eva_k-x_low", label: "Eva K", lang: "de", langLabel: "German (DE)", sizeMB: 20, q: "x-low", flag: "🇩🇪" },
  { id: "el_GR-rapunzelina-medium", label: "Rapunzelina", lang: "el", langLabel: "Greek (GR)", sizeMB: 60, q: "medium", flag: "🇬🇷" },
  { id: "de_DE-kerstin-medium", label: "Kerstin", lang: "de", langLabel: "German (DE)", sizeMB: 60, q: "medium", flag: "🇩🇪" },
  { id: "de_DE-karlsson-low", label: "Karlsson", lang: "de", langLabel: "German (DE)", sizeMB: 60, q: "low", flag: "🇩🇪" },
  { id: "de_DE-kerstin-low", label: "Kerstin", lang: "de", langLabel: "German (DE)", sizeMB: 60, q: "low", flag: "🇩🇪" },
  { id: "it_IT-serena-medium", label: "Serena", lang: "it", langLabel: "Italian (IT)", sizeMB: 61, q: "medium", flag: "🇮🇹" },
  { id: "it_IT-serena-high", label: "Serena", lang: "it", langLabel: "Italian (IT)", sizeMB: 109, q: "high", flag: "🇮🇹" },
  { id: "de_DE-mls-medium", label: "Mls", lang: "de", langLabel: "German (DE)", sizeMB: 73, q: "medium", flag: "🇩🇪" },
  { id: "el_GR-joy-medium", label: "Joy", lang: "el", langLabel: "Greek (GR)", sizeMB: 61, q: "medium", flag: "🇬🇷" },
  { id: "de_DE-pavoque-low", label: "Pavoque", lang: "de", langLabel: "German (DE)", sizeMB: 60, q: "low", flag: "🇩🇪" },
  { id: "de_DE-ramona-low", label: "Ramona", lang: "de", langLabel: "German (DE)", sizeMB: 60, q: "low", flag: "🇩🇪" },
  { id: "de_DE-thorsten-medium", label: "Thorsten", lang: "de", langLabel: "German (DE)", sizeMB: 60, q: "medium", flag: "🇩🇪" },
  { id: "de_DE-thorsten-low", label: "Thorsten", lang: "de", langLabel: "German (DE)", sizeMB: 60, q: "low", flag: "🇩🇪" },
  { id: "de_DE-thorsten-high", label: "Thorsten", lang: "de", langLabel: "German (DE)", sizeMB: 109, q: "high", flag: "🇩🇪" },
  { id: "de_DE-thorsten_emotional-medium", label: "Thorsten Emotional", lang: "de", langLabel: "German (DE)", sizeMB: 73, q: "medium", flag: "🇩🇪" },
  { id: "el_GR-rapunzelina-low", label: "Rapunzelina", lang: "el", langLabel: "Greek (GR)", sizeMB: 60, q: "low", flag: "🇬🇷" },
  { id: "hu_HU-anna-medium", label: "Anna", lang: "hu", langLabel: "Hungarian (HU)", sizeMB: 60, q: "medium", flag: "🇭🇺" },
  { id: "hu_HU-berta-medium", label: "Berta", lang: "hu", langLabel: "Hungarian (HU)", sizeMB: 60, q: "medium", flag: "🇭🇺" },
  { id: "hu_HU-imre-medium", label: "Imre", lang: "hu", langLabel: "Hungarian (HU)", sizeMB: 60, q: "medium", flag: "🇭🇺" },
  { id: "is_IS-bui-medium", label: "Bui", lang: "is", langLabel: "Icelandic (IS)", sizeMB: 73, q: "medium", flag: "🇮🇸" },
  { id: "no_NO-nvcc-medium", label: "Nvcc", lang: "no", langLabel: "Norwegian (NO)", sizeMB: 73, q: "medium", flag: "🇳🇴" },
  { id: "is_IS-salka-medium", label: "Salka", lang: "is", langLabel: "Icelandic (IS)", sizeMB: 73, q: "medium", flag: "🇮🇸" },
  { id: "is_IS-steinn-medium", label: "Steinn", lang: "is", langLabel: "Icelandic (IS)", sizeMB: 73, q: "medium", flag: "🇮🇸" },
  { id: "is_IS-ugla-medium", label: "Ugla", lang: "is", langLabel: "Icelandic (IS)", sizeMB: 73, q: "medium", flag: "🇮🇸" },
  { id: "it_IT-paola-medium", label: "Paola", lang: "it", langLabel: "Italian (IT)", sizeMB: 61, q: "medium", flag: "🇮🇹" },
  { id: "it_IT-riccardo-x_low", label: "Riccardo", lang: "it", langLabel: "Italian (IT)", sizeMB: 27, q: "x-low", flag: "🇮🇹" },
  { id: "kk_KZ-iseke-x_low", label: "Iseke", lang: "kk", langLabel: "Kazakh (KZ)", sizeMB: 27, q: "x-low", flag: "🇰🇿" },
  { id: "kk_KZ-issai-high", label: "Issai", lang: "kk", langLabel: "Kazakh (KZ)", sizeMB: 122, q: "high", flag: "🇰🇿" },
  { id: "kk_KZ-raya-x_low", label: "Raya", lang: "kk", langLabel: "Kazakh (KZ)", sizeMB: 27, q: "x-low", flag: "🇰🇿" },
  { id: "lb_LU-marylux-medium", label: "Marylux", lang: "lb", langLabel: "Luxembourgish (LU)", sizeMB: 60, q: "medium", flag: "🇱🇺" },
  { id: "ne_NP-chitwan-medium", label: "Chitwan", lang: "ne", langLabel: "Nepali (NP)", sizeMB: 60, q: "medium", flag: "🇳🇵" },
  { id: "ne_NP-google-x_low", label: "Google", lang: "ne", langLabel: "Nepali (NP)", sizeMB: 26, q: "x-low", flag: "🇳🇵" },
  { id: "ne_NP-google-medium", label: "Google", lang: "ne", langLabel: "Nepali (NP)", sizeMB: 73, q: "medium", flag: "🇳🇵" },
  { id: "pt_BR-jeff-medium", label: "Jeff", lang: "pt", langLabel: "Portuguese (BR)", sizeMB: 60, q: "medium", flag: "🇧🇷" },
  { id: "no_NO-talesyntese-medium", label: "Talesyntese", lang: "no", langLabel: "Norwegian (NO)", sizeMB: 60, q: "medium", flag: "🇳🇴" },
  { id: "pl_PL-darkman-medium", label: "Darkman", lang: "pl", langLabel: "Polish (PL)", sizeMB: 60, q: "medium", flag: "🇵🇱" },
  { id: "pl_PL-gosia-medium", label: "Gosia", lang: "pl", langLabel: "Polish (PL)", sizeMB: 60, q: "medium", flag: "🇵🇱" },
  { id: "pl_PL-mc_speech-medium", label: "Mc Speech", lang: "pl", langLabel: "Polish (PL)", sizeMB: 60, q: "medium", flag: "🇵🇱" },
  { id: "pl_PL-bass-high", label: "Bass", lang: "pl", langLabel: "Polish (PL)", sizeMB: 109, q: "high", flag: "🇵🇱" },
  { id: "pl_PL-mls_6892-low", label: "Mls 6892", lang: "pl", langLabel: "Polish (PL)", sizeMB: 60, q: "low", flag: "🇵🇱" },
  { id: "pt_BR-cadu-medium", label: "Cadu", lang: "pt", langLabel: "Portuguese (BR)", sizeMB: 60, q: "medium", flag: "🇧🇷" },
  { id: "pt_BR-edresson-low", label: "Edresson", lang: "pt", langLabel: "Portuguese (BR)", sizeMB: 60, q: "low", flag: "🇧🇷" },
  { id: "uk_UA-tetiana-high", label: "Tetiana", lang: "uk", langLabel: "Ukrainian (UA)", sizeMB: 109, q: "high", flag: "🇺🇦" },
  { id: "pt_BR-faber-medium", label: "Faber", lang: "pt", langLabel: "Portuguese (BR)", sizeMB: 60, q: "medium", flag: "🇧🇷" },
  { id: "ro_RO-mihai-medium", label: "Mihai", lang: "ro", langLabel: "Romanian (RO)", sizeMB: 60, q: "medium", flag: "🇷🇴" },
  { id: "ru_RU-denis-medium", label: "Denis", lang: "ru", langLabel: "Russian (RU)", sizeMB: 60, q: "medium", flag: "🇷🇺" },
  { id: "ru_RU-dmitri-medium", label: "Dmitri", lang: "ru", langLabel: "Russian (RU)", sizeMB: 60, q: "medium", flag: "🇷🇺" },
  { id: "sv_SE-lisa-medium", label: "Lisa", lang: "sv", langLabel: "Swedish (SE)", sizeMB: 61, q: "medium", flag: "🇸🇪" },
  { id: "ru_RU-irina-medium", label: "Irina", lang: "ru", langLabel: "Russian (RU)", sizeMB: 60, q: "medium", flag: "🇷🇺" },
  { id: "ru_RU-ruslan-medium", label: "Ruslan", lang: "ru", langLabel: "Russian (RU)", sizeMB: 60, q: "medium", flag: "🇷🇺" },
  { id: "uk_UA-oleksa-high", label: "Oleksa", lang: "uk", langLabel: "Ukrainian (UA)", sizeMB: 109, q: "high", flag: "🇺🇦" },
  { id: "uk_UA-mykyta-high", label: "Mykyta", lang: "uk", langLabel: "Ukrainian (UA)", sizeMB: 109, q: "high", flag: "🇺🇦" },
  { id: "sr_RS-serbski_institut-medium", label: "Serbski Institut", lang: "sr", langLabel: "Serbian (RS)", sizeMB: 73, q: "medium", flag: "🇷🇸" },
  { id: "sk_SK-lili-medium", label: "Lili", lang: "sk", langLabel: "Slovak (SK)", sizeMB: 60, q: "medium", flag: "🇸🇰" },
  { id: "sl_SI-artur-medium", label: "Artur", lang: "sl", langLabel: "Slovenian (SI)", sizeMB: 60, q: "medium", flag: "🇸🇮" },
  { id: "es_MX-ald-medium", label: "Ald", lang: "es", langLabel: "Spanish (MX)", sizeMB: 60, q: "medium", flag: "🇲🇽" },
  { id: "es_ES-carlfm-x_low", label: "Carlfm", lang: "es", langLabel: "Spanish (ES)", sizeMB: 27, q: "x-low", flag: "🇪🇸" },
  { id: "es_AR-daniela-high", label: "Daniela", lang: "es", langLabel: "Spanish (AR)", sizeMB: 109, q: "high", flag: "🇦🇷" },
  { id: "es_MX-claude-high", label: "Claude", lang: "es", langLabel: "Spanish (MX)", sizeMB: 60, q: "high", flag: "🇲🇽" },
  { id: "es_ES-davefx-medium", label: "Davefx", lang: "es", langLabel: "Spanish (ES)", sizeMB: 60, q: "medium", flag: "🇪🇸" },
  { id: "es_ES-mls_10246-low", label: "Mls 10246", lang: "es", langLabel: "Spanish (ES)", sizeMB: 60, q: "low", flag: "🇪🇸" },
  { id: "es_ES-mls_9972-low", label: "Mls 9972", lang: "es", langLabel: "Spanish (ES)", sizeMB: 60, q: "low", flag: "🇪🇸" },
  { id: "es_ES-sharvard-medium", label: "Sharvard", lang: "es", langLabel: "Spanish (ES)", sizeMB: 73, q: "medium", flag: "🇪🇸" },
  { id: "es_MX-ald-x_low", label: "Ald", lang: "es", langLabel: "Spanish (MX)", sizeMB: 20, q: "x-low", flag: "🇲🇽" },
  { id: "sv_SE-alma-medium", label: "Alma", lang: "sv", langLabel: "Swedish (SE)", sizeMB: 60, q: "medium", flag: "🇸🇪" },
  { id: "sw_CD-lanfrica-medium", label: "Lanfrica", lang: "sw", langLabel: "Swahili (CD)", sizeMB: 60, q: "medium", flag: "🇨🇩" },
  { id: "sv_SE-nst-medium", label: "Nst", lang: "sv", langLabel: "Swedish (SE)", sizeMB: 60, q: "medium", flag: "🇸🇪" },
  { id: "tr_TR-dfki-medium", label: "Dfki", lang: "tr", langLabel: "Turkish (TR)", sizeMB: 60, q: "medium", flag: "🇹🇷" },
  { id: "tr_TR-fahrettin-medium", label: "Fahrettin", lang: "tr", langLabel: "Turkish (TR)", sizeMB: 60, q: "medium", flag: "🇹🇷" },
  { id: "tr_TR-fettah-medium", label: "Fettah", lang: "tr", langLabel: "Turkish (TR)", sizeMB: 60, q: "medium", flag: "🇹🇷" },
  { id: "uk_UA-lada-x_low", label: "Lada", lang: "uk", langLabel: "Ukrainian (UA)", sizeMB: 20, q: "x-low", flag: "🇺🇦" },
  { id: "uk_UA-ukrainian_tts-medium", label: "Ukrainian Tts", lang: "uk", langLabel: "Ukrainian (UA)", sizeMB: 73, q: "medium", flag: "🇺🇦" },
  { id: "ur_PK-aegis_female-medium", label: "Aegis Female", lang: "ur", langLabel: "Urdu (PK)", sizeMB: 61, q: "medium", flag: "🇵🇰" },
  { id: "ur_PK-fasih-medium", label: "Fasih", lang: "ur", langLabel: "Urdu (PK)", sizeMB: 62, q: "medium", flag: "🇵🇰" },
  { id: "cy_GB-bu_tts-medium", label: "Bu Tts", lang: "cy", langLabel: "Welsh (GB)", sizeMB: 73, q: "medium", flag: "🇬🇧" },
  { id: "vi_VN-25hours_single-low", label: "25hours Single", lang: "vi", langLabel: "Vietnamese (VN)", sizeMB: 60, q: "low", flag: "🇻🇳" },
  { id: "vi_VN-vais1000-medium", label: "Vais1000", lang: "vi", langLabel: "Vietnamese (VN)", sizeMB: 60, q: "medium", flag: "🇻🇳" },
  { id: "vi_VN-vivos-x_low", label: "Vivos", lang: "vi", langLabel: "Vietnamese (VN)", sizeMB: 27, q: "x-low", flag: "🇻🇳" },
  { id: "cy_GB-gwryw_gogleddol-medium", label: "Gwryw Gogleddol", lang: "cy", langLabel: "Welsh (GB)", sizeMB: 61, q: "medium", flag: "🇬🇧" },
  { id: "bg_BG-dimitar-medium", label: "Dimitar", lang: "bg", langLabel: "Bulgarian (BG)", sizeMB: 60, q: "medium", flag: "🇧🇬" },
  { id: "bn_BD-google-medium", label: "Google", lang: "bn", langLabel: "Bengali (BD)", sizeMB: 73, q: "medium", flag: "🇧🇩" },
  { id: "et_EE-news-medium", label: "News", lang: "et", langLabel: "Estonian (EE)", sizeMB: 73, q: "medium", flag: "🇪🇪" },
  { id: "eu_ES-maider-medium", label: "Maider", lang: "eu", langLabel: "Basque (ES)", sizeMB: 61, q: "medium", flag: "🇪🇸" },
  { id: "eu_ES-antton-medium", label: "Antton", lang: "eu", langLabel: "Basque (ES)", sizeMB: 61, q: "medium", flag: "🇪🇸" },
  { id: "he_IL-saspeech-medium", label: "Saspeech", lang: "he", langLabel: "Hebrew (IL)", sizeMB: 60, q: "medium", flag: "🇮🇱" },
  { id: "hi_IN-pratham-medium", label: "Pratham", lang: "hi", langLabel: "Hindi (IN)", sizeMB: 61, q: "medium", flag: "🇮🇳" },
  { id: "hi_IN-rohan-medium", label: "Rohan", lang: "hi", langLabel: "Hindi (IN)", sizeMB: 60, q: "medium", flag: "🇮🇳" },
  { id: "hi_IN-priyamvada-medium", label: "Priyamvada", lang: "hi", langLabel: "Hindi (IN)", sizeMB: 61, q: "medium", flag: "🇮🇳" },
  { id: "hy_AM-gor-medium", label: "Gor", lang: "hy", langLabel: "Armenian (AM)", sizeMB: 61, q: "medium", flag: "🇦🇲" },
  { id: "id_ID-news_tts-medium", label: "News Tts", lang: "id", langLabel: "Indonesian (ID)", sizeMB: 60, q: "medium", flag: "🇮🇩" },
  { id: "ja_JP-hi_fi_captain-medium", label: "Hi Fi Captain", lang: "ja", langLabel: "Japanese (JP)", sizeMB: 73, q: "medium", flag: "🇯🇵" },
  { id: "ko_KR-kss-medium", label: "Kss", lang: "ko", langLabel: "Korean (KR)", sizeMB: 60, q: "medium", flag: "🇰🇷" },
  { id: "ku_TR-berfin_renas-medium", label: "Berfin Renas", lang: "ku", langLabel: "Kurmanji Kurdish (TR)", sizeMB: 73, q: "medium", flag: "🇹🇷" },
  { id: "lt_LT-reginute1-medium", label: "Reginute1", lang: "lt", langLabel: "Lithuanian (LT)", sizeMB: 61, q: "medium", flag: "🇱🇹" },
  { id: "lt_LT-ingute-medium", label: "Ingute", lang: "lt", langLabel: "Lithuanian (LT)", sizeMB: 61, q: "medium", flag: "🇱🇹" },
  { id: "lv_LV-aivars-medium", label: "Aivars", lang: "lv", langLabel: "Latvian (LV)", sizeMB: 61, q: "medium", flag: "🇱🇻" },
  { id: "ml_IN-meera-medium", label: "Meera", lang: "ml", langLabel: "Malayalam (IN)", sizeMB: 60, q: "medium", flag: "🇮🇳" },
  { id: "ml_IN-arjun-medium", label: "Arjun", lang: "ml", langLabel: "Malayalam (IN)", sizeMB: 60, q: "medium", flag: "🇮🇳" },
  { id: "mr_IN-google-medium", label: "Google", lang: "mr", langLabel: "Marathi (IN)", sizeMB: 73, q: "medium", flag: "🇮🇳" },
  { id: "sq_AL-edon-medium", label: "Edon", lang: "sq", langLabel: "Albanian (AL)", sizeMB: 61, q: "medium", flag: "🇦🇱" },
  { id: "te_IN-venkatesh-medium", label: "Venkatesh", lang: "te", langLabel: "Telugu (IN)", sizeMB: 61, q: "medium", flag: "🇮🇳" },
  { id: "te_IN-padmavathi-medium", label: "Padmavathi", lang: "te", langLabel: "Telugu (IN)", sizeMB: 61, q: "medium", flag: "🇮🇳" },
  { id: "te_IN-maya-medium", label: "Maya", lang: "te", langLabel: "Telugu (IN)", sizeMB: 60, q: "medium", flag: "🇮🇳" },
  { id: "th_TH-tsync2-medium", label: "Tsync2", lang: "th", langLabel: "Thai (TH)", sizeMB: 60, q: "medium", flag: "🇹🇭" },
];

let loadProgress = null; /* forwarded to the UI while a model downloads */
/* Exact download size from the bundled piper-voices catalogue, when known. */
function modelSizeMB(id){
  try{
    const v = voicesStatic[id];
    if(!v || !v.files) return null;
    const key = Object.keys(v.files).find(k => k.endsWith(".onnx"));
    return key ? Math.round(v.files[key].size_bytes / 1048576) : null;
  }catch(e){ return null; }
}
function mkSession(voiceId){
  return TtsSession.create({
    voiceId,
    wasmPaths: WASM_PATHS,
    allowLocalModels: true,
    fallbackStrategy: "local",   /* wasm lives in the extension — never hit CDNs */
    progress: p => { if(loadProgress) loadProgress(p); },
    logger: () => {}
  });
}

const bridge = {
  /* Is this voice id part of the piper-voices catalogue? */
  has: id => !!PATH_MAP[id],
  list: () => VOICES.map(v => ({ ...v, sizeMB: modelSizeMB(v.id) || v.sizeMB })),
  /* Voice ids already cached in OPFS (usable offline) */
  async cached(){ try{ return await stored(); }catch(e){ return []; } },
  /* Download a model ahead of time */
  async fetch(voiceId, onProgress){
    loadProgress = onProgress || null;
    try{ await download(voiceId, onProgress); } finally{ loadProgress = null; }
  },
  /* Make sure the engine + model are ready, then return the session */
  async load(voiceId, onProgress){
    loadProgress = onProgress || null;
    try{ return await mkSession(voiceId); } finally{ loadProgress = null; }
  },
  /* Synthesize text → WAV Blob */
  async speak(text, voiceId, onProgress){
    loadProgress = onProgress || null;
    try{
      const s = await mkSession(voiceId);
      return await s.predict(text);
    } finally{ loadProgress = null; }
  },
  async remove(voiceId){ await remove(voiceId); }
};
window.PiperBridge = bridge;
