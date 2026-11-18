# WordYarn 安卓离线版

适用于 Android 8.0 及以上。把 `dist/WordYarn.apk` 传到手机后打开，根据手机提示允许从当前文件管理器安装应用。安装完成后可取消此权限。

- 30 篇文章和词表随包携带；精读默认显示连续正文，点段落标题切换到逐句对照。
- 底栏可进入精读、查词、闪卡和统计。「今日」可以继续阅读、复习和查看近期答题记录。
- 学习记录保存在这台手机。更新时使用相同的签名覆盖安装；清除应用数据或卸载会删除记录。首版没有账号或同步。
- 内置 Kokoro 英语音色和 sherpa-onnx 引擎。文章、词汇、听写和自定义英文都在设备上实时生成语音，不调用系统朗读，也无需联网。首次朗读会加载模型，可能比后续稍慢。打开「朗读设置 → 试读英文」可试听自定义句子。

开发者准备 JDK 17 或更新版本、Android SDK Platform 35、Build Tools 35.0.1，以及：

- [sherpa-onnx 1.13.8 静态 ONNX Runtime AAR](https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-static-link-onnxruntime-1.13.8.aar)
- [Kokoro 英语 INT8 模型包](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-en-v0_19.tar.bz2)，解压后把含 `model.int8.onnx` 的目录传给 `-VoicePack`。
- [Kotlin 标准库 2.2.21](https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.2.21/kotlin-stdlib-2.2.21.jar)
- [D8 / R8 8.13.19](https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.13.19/r8-8.13.19.jar)，用于编译 Kotlin 2.2 的库。

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File android/build.ps1 -Jdk "<JDK 根目录>" -BuildTools "<SDK>/build-tools/35.0.1" -AndroidJar "<SDK>/platforms/android-35/android.jar" -D8Jar "<R8 JAR>" -SherpaAar "<AAR 文件>" -KotlinJar "<Kotlin JAR>" -VoicePack "<模型目录>"
node --test android/tests/offline.mjs android/tests/voice.mjs
```

构建脚本以 `web/site/` 为源，打包 Android 专用页面，产出供本机测试的签名 APK。默认签名文件位于 `%LOCALAPPDATA%/WordYarnBuild/android-debug.keystore`。请保留它以便覆盖安装；正式发布需要单独的发布签名。若安装后长期不更新，照常可离线阅读。

当前 APK 架构：ARM64、32 位 ARM、x86-64。模型、引擎和相关语言数据的来源与许可见 [第三方说明](licenses/NOTICE.md)。
