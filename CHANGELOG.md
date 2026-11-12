# 1.0.0 (2026-11-12)


### Bug Fixes

* a hang-up or an exit mid-run kills the SDK group and cleans the run folder ([b21eb3a](https://github.com/nx-solutions-ug/staging-device-check/commit/b21eb3ab72b01527545d56b44ee4052ee38ba6f9))
* a real failure in a check wins over nicht prüfbar hier ([3fb1aea](https://github.com/nx-solutions-ug/staging-device-check/commit/3fb1aeaf2b236c90a7fed7d344ed19de6c2b95a7))
* an abort sends SIGINT first, so the Playwright report is written ([f2cd1a4](https://github.com/nx-solutions-ug/staging-device-check/commit/f2cd1a44cae6565db26e01f621c035141ef0610a))
* check() fails closed when layout() could not measure on iOS ([29d2a67](https://github.com/nx-solutions-ug/staging-device-check/commit/29d2a67e0f559b87f6280d603b7c683a121202ca))
* check() owns each check's title and notes, planned checks in run.json ([5005d9d](https://github.com/nx-solutions-ug/staging-device-check/commit/5005d9df606507c21d075eec8ef53e64dab754a3))
* default run narrows to one iPhone and one Android phone ([2599eb7](https://github.com/nx-solutions-ug/staging-device-check/commit/2599eb72b7e4d75fe01eed87f8b81d2cd1b09ccd))
* evaluate arguments baked into the function for the iOS shim ([3db8972](https://github.com/nx-solutions-ug/staging-device-check/commit/3db8972c5027feadc80e4f5cc3051ba71dd4fddc))
* fixed XDG settings path and guaranteed gate password change ([a567855](https://github.com/nx-solutions-ug/staging-device-check/commit/a567855189d5c14b603ab19a519e2db9f4421e9b))
* locked send slots, demo mailbox, ID-based mail freshness, action button choice ([8ef3a19](https://github.com/nx-solutions-ug/staging-device-check/commit/8ef3a1997648de6450cf3957f854e76822b55a1e))
* no credentials in any yml copy, scalars kept as written ([fd729bb](https://github.com/nx-solutions-ug/staging-device-check/commit/fd729bbf9767af8c4353bafe9f1a81637b0e030a))
* one test per persona with a step per check, rows per step ([3e65a6c](https://github.com/nx-solutions-ug/staging-device-check/commit/3e65a6c0f0516c7961212eb460cfe2e1dc601fa4))
* run timeouts, SDK process group, host command and review minors ([dcdf190](https://github.com/nx-solutions-ug/staging-device-check/commit/dcdf190d43264b294927e3f09126c2747cf7f45c))
* stop on Ctrl+C or SIGTERM, cookie and touch fixes for real devices ([f96e1a1](https://github.com/nx-solutions-ug/staging-device-check/commit/f96e1a15d303c44fb225cc34042c176f38c5c18a))
* stop the run on an unstarted environment, terminal-only secret input ([d107c99](https://github.com/nx-solutions-ug/staging-device-check/commit/d107c99547cdfdd84141bd66d7161bdfdaf68e4c))
* the local gate session reaches the app hosts below the apex ([a597982](https://github.com/nx-solutions-ug/staging-device-check/commit/a59798256a25c048ed69f4260ac5671736e29482))


### Features

* app hosts, run token and gate login ([9d924fd](https://github.com/nx-solutions-ug/staging-device-check/commit/9d924fdaf73c2c2bb1fefa7934f0f28e6d51c392))
* browserstack.yml check and remaining minutes ([e93cd4a](https://github.com/nx-solutions-ug/staging-device-check/commit/e93cd4aab96e3f56461ff6698af0970fe3260793))
* carry the app's language cookie over from the local look ([41c2a45](https://github.com/nx-solutions-ug/staging-device-check/commit/41c2a4561a3562b68c2f83280ed104a7dd012c56))
* cli for setup, doctor, run and report ([8818d4d](https://github.com/nx-solutions-ug/staging-device-check/commit/8818d4dacf8444eac242e5e18f32e51fb10b2c15))
* plan minutes, state dir and German validation for the CLI ([d4c0e0b](https://github.com/nx-solutions-ug/staging-device-check/commit/d4c0e0baa062448d103bc3670e788177994a596a))
* playwright fixtures, run-token injection and layout rules ([27b9a23](https://github.com/nx-solutions-ug/staging-device-check/commit/27b9a23d8dde79c06576334b391b3f96f4d2c107))
* settings file and keychain secret store ([72f6baf](https://github.com/nx-solutions-ug/staging-device-check/commit/72f6bafd7a531c8a5118fca23c9da22557189ae6))
* setup and tests-e2e skills, playwright mcp ([865fed8](https://github.com/nx-solutions-ug/staging-device-check/commit/865fed85854716c13f89a5553a2fe4d1aec31a8b))
* sign-in by quick login or mailed code ([467c99e](https://github.com/nx-solutions-ug/staging-device-check/commit/467c99e6697ee7d3d699e050322c1007e64722eb))
* spec evaluate guard in run, doctor MCP check, genericity guard ([c1fe029](https://github.com/nx-solutions-ug/staging-device-check/commit/c1fe029a502bda3c83876aba566d059ac62fcc75))
