package au.ff.tracker.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * F&F Tracker for Wear OS (Pixel Watch).
 * Screens are in Ui.kt; data and syncing with the Google Sheet are in Repo.kt.
 */
class MainActivity : ComponentActivity() {
    private lateinit var repo: Repo

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repo = Repo(applicationContext)
        setContent { FFWatchApp(repo) }

        // While the app is on screen: pick up the link from the phone, then sync every 30 seconds.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                repo.loadConfig()
                while (isActive) {
                    repo.refresh()
                    delay(30_000)
                }
            }
        }
    }
}
