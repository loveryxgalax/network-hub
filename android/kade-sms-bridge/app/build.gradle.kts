import java.util.Properties
plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
// Release signing comes from keystore.properties (never committed): storeFile, storePassword, keyAlias, keyPassword.
val ks = Properties().apply { val f = rootProject.file("keystore.properties"); if (f.exists()) f.inputStream().use { load(it) } }
android {
    namespace = "com.kadenetworks.smsbridge"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.kadenetworks.smsbridge"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }
    signingConfigs {
        create("release") {
            if (ks.isNotEmpty()) {
                storeFile = file(ks.getProperty("storeFile"))
                storePassword = ks.getProperty("storePassword")
                keyAlias = ks.getProperty("keyAlias")
                keyPassword = ks.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (ks.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("com.journeyapps:zxing-android-embedded:4.3.0") { isTransitive = false }
    implementation("com.google.zxing:core:3.4.1")
}
