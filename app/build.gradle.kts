plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------------------------------------------------------------------------
// 版本号：唯一来源。只有明确要求发版时才修改这两个值。
// versionCode 每次发版 +1；versionName 必须与 Git 标签 vX.Y.Z 中的 X.Y.Z 一致。
// ---------------------------------------------------------------------------
val appVersionCode = 49
val appVersionName = "0.1.28"

// 可选：从环境变量读取发布签名（由 GitHub Actions 注入）。
// 未配置时回退到 debug 签名，保证工作流始终能产出可安装的 APK。
val envKeystoreFile: String? = System.getenv("KEYSTORE_FILE")
val envKeystorePassword: String? = System.getenv("KEYSTORE_PASSWORD")
val envKeyAlias: String? = System.getenv("KEY_ALIAS")
val envKeyPassword: String? = System.getenv("KEY_PASSWORD")
val hasReleaseKeystore: Boolean = listOf(envKeystoreFile, envKeystorePassword, envKeyAlias, envKeyPassword)
    .all { !it.isNullOrBlank() }

android {
    namespace = "com.eliaszwc.livolog"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.eliaszwc.livolog"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = file(envKeystoreFile!!)
                storePassword = envKeystorePassword
                keyAlias = envKeyAlias
                keyPassword = envKeyPassword
                // 由 openssl 生成的 PKCS12 密钥库，显式声明避免依 JDK 默认类型
                storeType = "PKCS12"
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // 没配置发布密钥时留空，由下面的任务守卫直接报错。
            // 绝不要回退到 debug 签名：CI 每次生成的 debug 密钥都不同，
            // 会导致新旧版本签名不一致、无法覆盖安装。
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                null
            }
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        buildConfig = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    lint {
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    // 冷启动第一帧：把系统默认那张「放大应用图标」的启动页换成纯品牌黑（API 26+ 行为一致）
    implementation("androidx.core:core-splashscreen:1.0.1")
}

// 发布包必须用固定密钥签名，否则直接失败。
tasks.matching { it.name.contains("Release") }.configureEach {
    doFirst {
        if (!hasReleaseKeystore) {
            throw GradleException(
                "缺少发布签名：请先设置 KEYSTORE_FILE / KEYSTORE_PASSWORD / KEY_ALIAS / " +
                    "KEY_PASSWORD 环境变量。用随机 debug 密钥签名会导致无法覆盖安装。"
            )
        }
    }
}
