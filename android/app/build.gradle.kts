import javax.inject.Inject
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Each GitHub build gets a bigger number, so a new APK installs as an update.
val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "au.ff.tracker"
    compileSdk = 35

    defaultConfig {
        applicationId = "au.ff.tracker"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    // The same key signs every build so updates install over the top (keeping your data).
    // It's only for installing the APK yourself. Don't use it for the Play Store.
    signingConfigs {
        create("sideload") {
            storeFile = rootProject.file("ff-tracker-sideload.keystore")
            storePassword = "fftracker"
            keyAlias = "fftracker"
            keyPassword = "fftracker"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
        }
        debug {
            signingConfig = signingConfigs.getByName("sideload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.gms:play-services-wearable:18.2.0") // hands the Sheet link to the watch app
}

/**
 * Copies the website files (index.html, css/, js/, icons/) from the repo root into the
 * APK, so the app and the website always run the same code.
 */
abstract class CopyWebAssets : DefaultTask() {
    @get:Internal
    abstract val webRoot: DirectoryProperty

    @get:Input
    abstract val includes: ListProperty<String>

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    val webFiles: FileTree
        get() {
            val patterns = includes.get() // read first: inside matching {} "includes" means something else
            return webRoot.get().asFileTree.matching { include(patterns) }
        }

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun copy() {
        val root = webRoot.get().asFile
        val patterns = includes.get()
        fs.sync {
            from(root) { include(patterns) }
            into(outputDir.get().dir("www"))
        }
    }
}

val copyWebAssets = tasks.register<CopyWebAssets>("copyWebAssets") {
    webRoot.set(rootProject.layout.projectDirectory.asFile.parentFile)
    includes.set(listOf("index.html", "manifest.webmanifest", "css/**", "js/**", "icons/**"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyWebAssets, CopyWebAssets::outputDir)
    }
}
