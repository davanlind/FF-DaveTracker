package au.ff.tracker.wear

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.math.abs
import kotlin.math.roundToInt

/* ------------------------------------------------------------------ */
/*  Data shapes (same fields as the website, see js/store.js)          */
/* ------------------------------------------------------------------ */

data class Segment(val start: String, val end: String, val location: String)

data class Active(
    val id: String,
    val task: String,
    val type: String,
    val taskId: String,
    val planItemId: String,
    val planId: String,
    val segments: List<Segment>,
) {
    val running: Boolean get() = segments.isNotEmpty() && segments.last().end.isEmpty()
    val lastTouched: String get() = segments.lastOrNull()?.let { it.end.ifEmpty { it.start } } ?: ""
}

data class LogRow(
    val date: String,
    val start: String,
    val minutes: Int,
    val task: String,
    val location: String,
    val type: String,
    val taskId: String,
)

/** Something you can start: a planned item, a repeatable task or a one-off name. */
data class Choice(
    val name: String,
    val type: String,
    val taskId: String,
    val planItemId: String,
    val planId: String,
    val group: String,
    val sub: String,
)

/**
 * Everything the watch knows, plus the actions you can take.
 * Talks straight to the same Google Sheet web app as the phone and website.
 * Changes are applied on the watch at once and queued, so it works offline and catches up later.
 */
class Repo(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("ff", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val syncLock = Mutex()
    private val zone: ZoneId get() = ZoneId.systemDefault()

    var url by mutableStateOf(prefs.getString("url", "") ?: "")
        private set
    var key by mutableStateOf(prefs.getString("key", "") ?: "")
        private set
    val linked: Boolean get() = url.isNotBlank() && key.isNotBlank()

    var active by mutableStateOf<List<Active>>(emptyList())
        private set
    var log by mutableStateOf<List<LogRow>>(emptyList())
        private set
    private var tasks: List<JSONObject> = emptyList()
    private var plans: List<JSONObject> = emptyList()
    private var planItems by mutableStateOf<List<JSONObject>>(emptyList())
    private var pins by mutableStateOf<List<JSONObject>>(emptyList())
    private var colors: Map<String, String> = emptyMap()

    var currentLocation by mutableStateOf(prefs.getString("location", "") ?: "")
        private set
    var lastWorked by mutableStateOf(prefs.getString("worked", "Solo") ?: "Solo")
        private set
    var status by mutableStateOf("")
        private set
    var pending by mutableStateOf(queue().length())
        private set
    var loaded by mutableStateOf(false)
        private set

    init {
        prefs.getString("cache", null)?.let { runCatching { applyData(JSONObject(it)) } }
    }

    /* ---------------- linking (Sheet link + key come from the phone app) ---------------- */

    suspend fun loadConfig() {
        try {
            val items = Wearable.getDataClient(ctx).dataItems.await()
            try {
                for (item in items) {
                    if (item.uri.path == "/ff-config") {
                        val map = DataMapItem.fromDataItem(item).dataMap
                        val u = map.getString("url") ?: ""
                        val k = map.getString("key") ?: ""
                        if (u != url || k != key) {
                            url = u
                            key = k
                            prefs.edit().putString("url", u).putString("key", k).apply()
                        }
                    }
                }
            } finally {
                items.release()
            }
        } catch (e: Exception) {
            // No phone connection right now: keep what we had.
        }
    }

    /* ---------------- talking to the Sheet ---------------- */

    /** HTTP with redirects handled by hand (Google answers a POST with a redirect to the result). */
    private fun http(method: String, target: String, body: String?): String {
        var next = target
        var m = method
        var payload = body
        repeat(6) {
            val c = URL(next).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 15000
            c.readTimeout = 25000
            c.requestMethod = m
            if (payload != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "text/plain;charset=utf-8")
                c.outputStream.use { it.write(payload!!.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            if (code in 300..399) {
                next = c.getHeaderField("Location") ?: throw IOException("Redirect without a location")
                m = "GET"
                payload = null
                c.disconnect()
                return@repeat
            }
            val stream = if (code >= 400) c.errorStream else c.inputStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            return text
        }
        throw IOException("Too many redirects")
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun parse(text: String): JSONObject {
        val json = try {
            JSONObject(text)
        } catch (e: Exception) {
            throw IOException("Sheet sent something unexpected. Check the link on your phone.")
        }
        if (!json.optBoolean("ok")) throw IOException(json.optString("error", "The Sheet said no"))
        return json
    }

    private fun queue(): JSONArray = runCatching { JSONArray(prefs.getString("queue", "[]")) }.getOrDefault(JSONArray())

    private fun enqueue(op: JSONObject) {
        val q = queue()
        q.put(op)
        prefs.edit().putString("queue", q.toString()).apply()
        pending = q.length()
    }

    /** Send waiting changes, then download the latest. Safe to call any time. */
    suspend fun refresh() {
        if (!linked) return
        syncLock.withLock {
            try {
                val q = queue()
                if (q.length() > 0) {
                    val body = JSONObject().put("action", "apply").put("key", key).put("ops", q).toString()
                    withContext(Dispatchers.IO) { parse(http("POST", url, body)) }
                    // drop what was sent (anything added meanwhile stays)
                    val now = queue()
                    val rest = JSONArray()
                    for (i in q.length() until now.length()) rest.put(now.get(i))
                    prefs.edit().putString("queue", rest.toString()).apply()
                    pending = rest.length()
                }
                val since = LocalDate.now(zone).minusDays(60).toString()
                val text = withContext(Dispatchers.IO) {
                    http("GET", "$url?action=summary&since=${enc(since)}&key=${enc(key)}", null)
                }
                val json = try {
                    parse(text)
                } catch (e: IOException) {
                    if (e.message?.contains("Unknown action") == true) {
                        parse(withContext(Dispatchers.IO) { http("GET", "$url?action=all&key=${enc(key)}", null) })
                    } else throw e
                }
                val data = json.getJSONObject("data")
                // keep our own not-yet-sent changes on top of what the Sheet says
                applyData(data)
                replayQueue()
                prefs.edit().putString("cache", data.toString()).apply()
                status = if (pending > 0) "$pending waiting to send" else ""
            } catch (e: Exception) {
                status = if (pending > 0) "Offline · $pending waiting" else (e.message ?: "Couldn't reach the Sheet")
            }
        }
    }

    private fun sync() {
        scope.launch { refresh() }
    }

    private fun arr(o: JSONObject, name: String): List<JSONObject> {
        val a = o.optJSONArray(name) ?: return emptyList()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }
    }

    private fun applyData(data: JSONObject) {
        active = arr(data, "active").mapNotNull { toActive(it) }
        log = arr(data, "log").map {
            LogRow(
                date = it.optString("date"), start = it.optString("start"),
                minutes = it.optDouble("minutes", 0.0).roundToInt(), task = it.optString("task"),
                location = it.optString("location"), type = it.optString("type"), taskId = it.optString("taskId"),
            )
        }
        tasks = arr(data, "tasks")
        plans = arr(data, "plans")
        planItems = arr(data, "planItems")
        pins = arr(data, "pins")
        colors = arr(data, "colors").associate { it.optString("name").trim().lowercase() to it.optString("color") }
        loaded = true
    }

    /** Re-apply queued changes to 'active' and the log so the screen matches what we did. */
    private fun replayQueue() {
        val q = queue()
        for (i in 0 until q.length()) {
            val op = q.optJSONObject(i) ?: continue
            val table = op.optString("table")
            if (op.optString("op") == "delete") {
                if (table == "active") active = active.filter { it.id != op.optString("id") }
                if (table == "pins") pins = pins.filter { it.optString("id") != op.optString("id") }
            } else {
                val r = op.optJSONObject("record") ?: continue
                when (table) {
                    "active" -> toActive(r)?.let { a -> active = active.filter { it.id != a.id } + a }
                    "pins" -> pins = pins.filter { it.optString("id") != r.optString("id") } + r
                    "log" -> log = log + LogRow(
                        r.optString("date"), r.optString("start"), r.optInt("minutes"), r.optString("task"),
                        r.optString("location"), r.optString("type"), r.optString("taskId"),
                    )
                }
            }
        }
    }

    private fun toActive(o: JSONObject): Active? {
        val id = o.optString("id")
        if (id.isEmpty()) return null
        val raw = o.opt("segments")
        val segs: JSONArray = when (raw) {
            is JSONArray -> raw
            is String -> runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
            else -> JSONArray()
        }
        val list = (0 until segs.length()).mapNotNull { i ->
            segs.optJSONObject(i)?.let { Segment(it.optString("start"), it.optString("end"), it.optString("location")) }
        }.filter { it.start.isNotEmpty() }
        return Active(
            id, o.optString("task"), o.optString("type").ifEmpty { if (o.optString("taskId").isNotEmpty()) "Repeatable" else "One-off" },
            o.optString("taskId"), o.optString("planItemId"), o.optString("planId"), list,
        )
    }

    private fun Active.toJson(): JSONObject {
        val segs = JSONArray()
        segments.forEach { segs.put(JSONObject().put("start", it.start).put("end", it.end).put("location", it.location)) }
        return JSONObject()
            .put("id", id).put("task", task).put("type", type).put("taskId", taskId)
            .put("planItemId", planItemId).put("planId", planId).put("segments", segs).put("updatedAt", nowIso())
    }

    /* ---------------- small helpers ---------------- */

    private fun nowIso(): String = Instant.now().truncatedTo(ChronoUnit.MILLIS).toString()

    private fun uid(prefix: String): String {
        val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
        val rand = (1..5).map { chars.random() }.joinToString("")
        return "${prefix}_${java.lang.Long.toString(System.currentTimeMillis(), 36)}$rand"
    }

    private fun upsert(table: String, record: JSONObject) {
        enqueue(JSONObject().put("op", "upsert").put("table", table).put("record", record))
    }

    private fun delete(table: String, id: String) {
        enqueue(JSONObject().put("op", "delete").put("table", table).put("id", id))
    }

    private fun saveActive(a: Active) {
        active = active.filter { it.id != a.id } + a
        upsert("active", a.toJson())
    }

    fun running(): Active? = active.firstOrNull { it.running }

    fun onHold(): List<Active> = active.filter { !it.running }.sortedByDescending { it.lastTouched }

    fun elapsedMs(a: Active, now: Long = System.currentTimeMillis()): Long = a.segments.sumOf { s ->
        val st = runCatching { Instant.parse(s.start).toEpochMilli() }.getOrDefault(now)
        val en = if (s.end.isEmpty()) now else runCatching { Instant.parse(s.end).toEpochMilli() }.getOrDefault(now)
        maxOf(0L, en - st)
    }

    fun today(): String = LocalDate.now(zone).toString()

    /** Minutes logged today plus time on open timers today. */
    fun todayMinutes(now: Long = System.currentTimeMillis()): Int {
        val t = today()
        val logged = log.filter { it.date == t }.sumOf { it.minutes }
        val dayStart = LocalDate.now(zone).atStartOfDay(zone).toInstant().toEpochMilli()
        val open = active.sumOf { a ->
            a.segments.sumOf { s ->
                val st = runCatching { Instant.parse(s.start).toEpochMilli() }.getOrDefault(now)
                val en = if (s.end.isEmpty()) now else runCatching { Instant.parse(s.end).toEpochMilli() }.getOrDefault(now)
                maxOf(0L, en - maxOf(st, dayStart))
            }
        }
        return logged + (open / 60000L).toInt()
    }

    private fun k(s: String) = s.trim().lowercase()

    /* ---------------- colours (same palette as the website) ---------------- */

    private val palette = listOf(0xFF2A78D6, 0xFFEB6834, 0xFF1BAF7A, 0xFFEDA100, 0xFFE87BA4, 0xFF008300, 0xFF6250D6, 0xFFE34948)

    fun colorFor(name: String): Color {
        val hex = colors[k(name)]
        if (hex != null && hex.length == 7 && hex.startsWith("#")) {
            runCatching { return Color(("FF" + hex.substring(1)).toLong(16)) }
        }
        return Color(palette[abs(k(name).hashCode()) % palette.size])
    }

    /* ---------------- what to show on the task pages ---------------- */

    private fun currentPlanId(): String? {
        val t = today()
        return plans.firstOrNull { it.optString("start") <= t && t <= it.optString("end") }?.optString("id")
    }

    private fun openPlanItems(): List<JSONObject> {
        val pid = currentPlanId() ?: return emptyList()
        return planItems.filter { it.optString("planId") == pid && !it.optBoolean("done") }
    }

    fun isPinned(kind: String, name: String) = pins.any { it.optString("id") == "pin:$kind:${k(name)}" }

    /** Task pages: open timers on hold, pinned, planned, most used, repeatable, recent one-offs. */
    fun choices(): List<Choice> {
        val out = mutableListOf<Choice>()
        val seen = mutableSetOf<String>()
        val runningName = running()?.let { k(it.task) }
        if (runningName != null) seen.add(runningName)
        val plannedByName = openPlanItems().associateBy { k(it.optString("task")) }
        val tasksByName = tasks.filter { it.opt("active") != false && it.optString("active") != "false" }.associateBy { k(it.optString("name")) }
        val since = LocalDate.now(zone).minusDays(60).toString()
        val counts = log.filter { it.date >= since }.groupBy { k(it.task) }
        val lastUsed = log.groupBy { k(it.task) }.mapValues { e -> e.value.maxOf { it.date + " " + it.start } }

        fun add(name: String, group: String, sub: String? = null) {
            val key = k(name)
            if (key.isEmpty() || key in seen) return
            seen.add(key)
            val p = plannedByName[key]
            val t = tasksByName[key]
            val c = when {
                p != null -> Choice(p.optString("task"), p.optString("type").ifEmpty { "Repeatable" }, p.optString("taskId"), p.optString("id"), p.optString("planId"), group,
                    sub ?: "Target ${fmtMins(p.optDouble("targetMinutes", 0.0).roundToInt())}")
                t != null -> Choice(t.optString("name"), "Repeatable", t.optString("id"), "", "", group, sub ?: t.optString("category").ifEmpty { "Repeatable task" })
                else -> Choice(name.trim(), "One-off", "", "", "", group, sub ?: "One-off")
            }
            out.add(c)
        }

        onHold().forEach { a ->
            if (k(a.task) !in seen) {
                seen.add(k(a.task))
                out.add(Choice(a.task, a.type, a.taskId, a.planItemId, a.planId, "On hold", "${fmtMins((elapsedMs(a) / 60000).toInt())} so far"))
            }
        }
        pins.filter { it.optString("kind") == "task" }.sortedBy { it.optString("name") }.forEach { add(it.optString("name"), "Pinned") }
        openPlanItems().forEach { add(it.optString("task"), "Planned") }
        counts.filter { it.value.size >= 2 }.entries.sortedByDescending { it.value.size }.take(5)
            .forEach { add(it.value.first().task, "Most used", "Used ${it.value.size} times") }
        tasksByName.values.sortedBy { it.optString("name") }.forEach { add(it.optString("name"), "Your tasks") }
        lastUsed.entries.sortedByDescending { it.value }.take(8).forEach { e ->
            val row = log.first { k(it.task) == e.key }
            add(row.task, "Recent")
        }
        return out.take(30)
    }

    fun openFor(name: String): Active? = active.firstOrNull { k(it.task) == k(name) }

    /** Places to pick: pinned, then most used, then recent. */
    fun locations(): List<Pair<String, String>> {
        val out = mutableListOf<Pair<String, String>>()
        val seen = mutableSetOf<String>()
        fun add(name: String, sub: String) {
            if (k(name).isEmpty() || k(name) in seen) return
            seen.add(k(name))
            out.add(name.trim() to sub)
        }
        pins.filter { it.optString("kind") == "location" }.forEach { add(it.optString("name"), "Pinned") }
        val used = log.filter { it.location.isNotBlank() }.groupBy { k(it.location) }
        used.entries.sortedByDescending { it.value.size }.forEach { add(it.value.first().location, "Used ${it.value.size} times") }
        active.flatMap { it.segments }.forEach { if (it.location.isNotBlank()) add(it.location, "On a timer") }
        return out
    }

    /* ---------------- actions (same rules as js/timers.js) ---------------- */

    private fun pauseRunning(): Active? {
        val r = running() ?: return null
        val segs = r.segments.dropLast(1) + r.segments.last().copy(end = nowIso())
        val n = r.copy(segments = segs)
        saveActive(n)
        return n
    }

    private fun same(a: Active, c: Choice): Boolean = when {
        c.planItemId.isNotEmpty() -> a.planItemId == c.planItemId
        c.taskId.isNotEmpty() -> a.taskId == c.taskId && a.planItemId.isEmpty()
        else -> a.type == "One-off" && a.planItemId.isEmpty() && k(a.task) == k(c.name)
    }

    /** Start (or resume) a task. Whatever was running goes on hold. */
    fun start(c: Choice) {
        val existing = active.firstOrNull { same(it, c) } ?: active.firstOrNull { k(it.task) == k(c.name) }
        if (existing != null) {
            if (!existing.running) resume(existing.id)
            return
        }
        pauseRunning()
        saveActive(Active(uid("act"), c.name, c.type, c.taskId, c.planItemId, c.planId, listOf(Segment(nowIso(), "", currentLocation))))
        sync()
    }

    fun resume(id: String) {
        val r = active.firstOrNull { it.id == id } ?: return
        if (r.running) return
        pauseRunning()
        val fresh = active.first { it.id == id }
        saveActive(fresh.copy(segments = fresh.segments + Segment(nowIso(), "", currentLocation)))
        sync()
    }

    fun pause() {
        pauseRunning()
        sync()
    }

    /** Set where you are. If a task is running, time from now counts at the new place. */
    fun setLocation(location: String) {
        currentLocation = location
        prefs.edit().putString("location", location).apply()
        val r = running() ?: return
        val last = r.segments.last()
        if (last.location == location) return
        val startMs = runCatching { Instant.parse(last.start).toEpochMilli() }.getOrDefault(0L)
        val segs = if (System.currentTimeMillis() - startMs < 60000) {
            r.segments.dropLast(1) + last.copy(location = location)
        } else {
            val now = nowIso()
            r.segments.dropLast(1) + last.copy(end = now) + Segment(now, "", location)
        }
        saveActive(r.copy(segments = segs))
        sync()
    }

    data class Stint(val date: String, val start: String, val end: String, val minutes: Int, val location: String)

    /** The Log rows a timer becomes: one per stretch, skipping stretches under a minute. */
    fun stints(a: Active, now: Long = System.currentTimeMillis()): List<Stint> {
        val rows = a.segments.map { s ->
            val st = runCatching { Instant.parse(s.start) }.getOrDefault(Instant.ofEpochMilli(now))
            val en = if (s.end.isEmpty()) Instant.ofEpochMilli(now) else runCatching { Instant.parse(s.end) }.getOrDefault(Instant.ofEpochMilli(now))
            val minutes = ((en.toEpochMilli() - st.toEpochMilli()) / 60000.0).roundToInt()
            val local = LocalDateTime.ofInstant(st, zone)
            val startMins = local.hour * 60 + local.minute
            Stint(local.toLocalDate().toString(), hm(startMins), hm(startMins + maxOf(minutes, 1)), minutes, s.location)
        }
        val kept = rows.filter { it.minutes >= 1 }
        if (kept.isNotEmpty()) return kept
        val first = rows.firstOrNull() ?: return emptyList()
        return listOf(first.copy(minutes = 1))
    }

    /** Finish a timer: save its time to the Log and close it. */
    fun finish(id: String, worked: String, plannedDone: Boolean?) {
        val a = active.firstOrNull { it.id == id } ?: return
        val now = System.currentTimeMillis()
        stints(a, now).forEach { s ->
            val rec = JSONObject()
                .put("id", uid("log")).put("date", s.date).put("start", s.start).put("end", s.end)
                .put("minutes", s.minutes).put("hours", Math.round(s.minutes / 60.0 * 100) / 100.0)
                .put("task", a.task).put("location", s.location).put("type", a.type)
                .put("worked", worked).put("helpers", "").put("notes", "")
                .put("planId", a.planId).put("planItemId", a.planItemId).put("taskId", a.taskId)
                .put("updatedAt", nowIso())
            upsert("log", rec)
            log = log + LogRow(s.date, s.start, s.minutes, a.task, s.location, a.type, a.taskId)
        }
        if (plannedDone != null && a.planItemId.isNotEmpty()) {
            planItems.firstOrNull { it.optString("id") == a.planItemId }?.let { item ->
                val copy = JSONObject(item.toString()).put("done", plannedDone).put("updatedAt", nowIso())
                upsert("planItems", copy)
                planItems = planItems.map { if (it.optString("id") == a.planItemId) copy else it }
            }
        }
        active = active.filter { it.id != id }
        delete("active", id)
        lastWorked = worked
        prefs.edit().putString("worked", worked).apply()
        sync()
    }

    fun discard(id: String) {
        active = active.filter { it.id != id }
        delete("active", id)
        sync()
    }

    fun togglePin(kind: String, name: String) {
        val id = "pin:$kind:${k(name)}"
        if (isPinned(kind, name)) {
            pins = pins.filter { it.optString("id") != id }
            delete("pins", id)
        } else {
            val rec = JSONObject().put("id", id).put("kind", kind).put("name", name.trim()).put("updatedAt", nowIso())
            pins = pins + rec
            upsert("pins", rec)
        }
        sync()
    }

    fun plannedItemFor(a: Active): JSONObject? = planItems.firstOrNull { it.optString("id") == a.planItemId }

    companion object {
        fun hm(mins: Int): String {
            val m = ((mins % 1440) + 1440) % 1440
            return "%02d:%02d".format(m / 60, m % 60)
        }

        fun fmtMins(mins: Int): String {
            val h = mins / 60
            val m = mins % 60
            return when {
                h > 0 && m > 0 -> "${h}h ${m}m"
                h > 0 -> "${h}h"
                else -> "${m}m"
            }
        }

        fun clock(ms: Long): String {
            val t = maxOf(0L, ms / 1000)
            return "%d:%02d:%02d".format(t / 3600, (t % 3600) / 60, t % 60)
        }
    }
}
