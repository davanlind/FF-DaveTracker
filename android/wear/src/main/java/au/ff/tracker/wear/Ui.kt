package au.ff.tracker.wear

import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.AutoCenteringParams
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Checkbox
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.CompactButton
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.RadioButton
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.ToggleChip
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/* ------------------------------------------------------------------ */
/*  Look and feel                                                     */
/* ------------------------------------------------------------------ */

private val Accent = Color(0xFFD9774F)      // F&F terracotta, a touch brighter for a black screen
private val Ink = Color(0xFFF4F1EC)
private val Muted = Color(0xFF9DA39E)
private val Track = Color(0xFF1C2320)
private val Surface = Color(0xFF151A17)

@Composable
fun FFTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            primary = Accent,
            primaryVariant = Accent,
            secondary = Accent,
            background = Color.Black,
            surface = Surface,
            onPrimary = Color.White,
            onSecondary = Color.White,
            onBackground = Ink,
            onSurface = Ink,
            onSurfaceVariant = Muted,
        ),
        content = content,
    )
}

/** Ticks once a second while on screen. */
@Composable
private fun rememberNow(): Long {
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            value = System.currentTimeMillis()
            delay(1000)
        }
    }
    return now
}

/** Crown / rotating bezel scrolls a list. */
private fun Modifier.crownScroll(state: ScalingLazyListState, focus: FocusRequester, scope: kotlinx.coroutines.CoroutineScope) =
    this
        .onRotaryScrollEvent {
            scope.launch { state.scrollBy(it.verticalScrollPixels) }
            true
        }
        .focusRequester(focus)
        .focusable()

/* ---------- little drawn icons (play / pause / stop) ---------- */

@Composable
private fun PlayGlyph(size: Dp, color: Color) {
    Canvas(Modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val p = Path().apply {
            moveTo(w * 0.30f, h * 0.18f)
            lineTo(w * 0.84f, h * 0.50f)
            lineTo(w * 0.30f, h * 0.82f)
            close()
        }
        drawPath(p, color)
    }
}

@Composable
private fun PauseGlyph(size: Dp, color: Color) {
    Canvas(Modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val bar = w * 0.22f
        val r = androidx.compose.ui.geometry.CornerRadius(bar * 0.3f)
        drawRoundRect(color, Offset(w * 0.22f, h * 0.18f), Size(bar, h * 0.64f), r)
        drawRoundRect(color, Offset(w * 0.56f, h * 0.18f), Size(bar, h * 0.64f), r)
    }
}

@Composable
private fun StopGlyph(size: Dp, color: Color) {
    Canvas(Modifier.size(size)) {
        val w = this.size.width
        drawRoundRect(color, Offset(w * 0.24f, w * 0.24f), Size(w * 0.52f, w * 0.52f), androidx.compose.ui.geometry.CornerRadius(w * 0.08f))
    }
}

/* ------------------------------------------------------------------ */
/*  App                                                               */
/* ------------------------------------------------------------------ */

@Composable
fun FFWatchApp(repo: Repo) {
    FFTheme {
        if (!repo.linked) {
            LinkScreen(repo)
            return@FFTheme
        }
        val nav = rememberSwipeDismissableNavController()
        SwipeDismissableNavHost(navController = nav, startDestination = "home") {
            composable("home") {
                HomeScreen(repo, onEdit = { name -> nav.navigate("edit/${Uri.encode(name)}") })
            }
            composable("edit/{name}") { entry ->
                val name = Uri.decode(entry.arguments?.getString("name") ?: "")
                EditScreen(
                    repo, name,
                    onFinish = { id -> nav.navigate("finish/$id") },
                    onLocation = { nav.navigate("location") },
                    onDone = { nav.popBackStack("home", false) },
                )
            }
            composable("finish/{id}") { entry ->
                FinishScreen(repo, entry.arguments?.getString("id") ?: "", onDone = { nav.popBackStack("home", false) })
            }
            composable("location") {
                LocationScreen(repo, onDone = { nav.popBackStack() })
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Not linked yet                                                    */
/* ------------------------------------------------------------------ */

@Composable
private fun LinkScreen(repo: Repo) {
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 26.dp)) {
            Text("F&F", color = Accent, fontSize = 22.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(6.dp))
            Text(
                "Open F&F Tracker on your phone, connected to your Google Sheet. It links this watch by itself.",
                color = Ink, fontSize = 13.sp, textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(10.dp))
            CompactButton(onClick = { scope.launch { repo.loadConfig(); repo.refresh() } }) {
                Icon(Icons.Filled.Refresh, contentDescription = "Try again")
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/*  Home: swipe up/down between the main window and task pages        */
/* ------------------------------------------------------------------ */

@Composable
private fun HomeScreen(repo: Repo, onEdit: (String) -> Unit) {
    val choices = repo.choices()
    val pageCount = 1 + choices.size
    val pager = rememberPagerState(pageCount = { pageCount })
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    var crown by remember { mutableFloatStateOf(0f) }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onRotaryScrollEvent { e ->
                // turning the crown also flips pages
                crown += e.verticalScrollPixels
                if (abs(crown) > 70f) {
                    val dir = if (crown > 0) 1 else -1
                    crown = 0f
                    scope.launch { pager.animateScrollToPage((pager.currentPage + dir).coerceIn(0, pageCount - 1)) }
                }
                true
            }
            .focusRequester(focus)
            .focusable(),
    ) {
        VerticalPager(state = pager, modifier = Modifier.fillMaxSize(), beyondViewportPageCount = 1) { page ->
            if (page == 0) {
                NowPage(repo, onEdit = onEdit, onBrowse = { scope.launch { pager.animateScrollToPage(1) } })
            } else {
                val c = choices.getOrNull(page - 1)
                if (c != null) {
                    TaskPage(repo, c, onEdit = onEdit, onStarted = { scope.launch { pager.animateScrollToPage(0) } })
                }
            }
        }
        PageDots(pager, pageCount, Modifier.align(Alignment.CenterEnd).padding(end = 5.dp))
        TimeText()
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}

/** Little dots down the right edge showing where you are. */
@Composable
private fun PageDots(pager: PagerState, count: Int, modifier: Modifier) {
    if (count <= 1) return
    val window = 7
    val first = (pager.currentPage - window / 2).coerceIn(0, maxOf(0, count - window))
    val last = minOf(count, first + window)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        for (i in first until last) {
            val on = i == pager.currentPage
            Box(
                Modifier
                    .size(if (on) 6.dp else 4.dp)
                    .clip(CircleShape)
                    .background(if (on) Ink else Muted.copy(alpha = 0.5f)),
            )
        }
    }
}

/* ---------- main window: what's happening now ---------- */

@Composable
private fun NowPage(repo: Repo, onEdit: (String) -> Unit, onBrowse: () -> Unit) {
    val now = rememberNow()
    val r = repo.running()
    val color = r?.let { repo.colorFor(it.task) } ?: Accent
    val haptic = LocalHapticFeedback.current
    val elapsed = r?.let { repo.elapsedMs(it, now) } ?: 0L
    val held = repo.onHold().size

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.radialGradient(listOf(color.copy(alpha = if (r != null) 0.22f else 0.10f), Color.Black))),
        contentAlignment = Alignment.Center,
    ) {
        // the ring fills once an hour, like a stopwatch sweep; a dot marks the seconds
        Canvas(Modifier.fillMaxSize().padding(5.dp)) {
            val stroke = 9.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            drawArc(Track, -90f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
            if (r != null) {
                val frac = ((elapsed / 1000) % 3600) / 3600f
                drawArc(color, -90f, maxOf(2f, 360f * frac), false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
                val secAngle = Math.toRadians(((elapsed / 1000) % 60) * 6.0 - 90.0)
                val rad = (size.width - stroke) / 2
                drawCircle(Ink, 3.dp.toPx(), Offset(center.x + (rad * Math.cos(secAngle)).toFloat(), center.y + (rad * Math.sin(secAngle)).toFloat()))
            }
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 30.dp)) {
            if (r != null) {
                Text("WORKING ON", color = color, fontSize = 10.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
                Text(
                    r.task, color = Ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    Repo.clock(elapsed), color = Ink, fontSize = 34.sp, fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.display3.copy(fontFeatureSettings = "tnum"),
                )
                val loc = r.segments.lastOrNull()?.location ?: ""
                if (loc.isNotBlank()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Place, null, tint = Muted, modifier = Modifier.size(12.dp))
                        Text(loc, color = Muted, fontSize = 11.sp, maxLines = 1)
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(
                        onClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); repo.pause() },
                        colors = ButtonDefaults.primaryButtonColors(backgroundColor = color),
                        modifier = Modifier.size(48.dp),
                    ) { PauseGlyph(22.dp, Color.White) }
                    CompactButton(
                        onClick = { onEdit(r.task) },
                        colors = ButtonDefaults.secondaryButtonColors(backgroundColor = Surface),
                    ) { Icon(Icons.Filled.Edit, contentDescription = "Edit", tint = Ink, modifier = Modifier.size(16.dp)) }
                }
            } else {
                Text("F&F", color = Accent, fontSize = 20.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp)
                Text("Nothing running", color = Ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(Repo.fmtMins(repo.todayMinutes(now)), color = Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Text("today", color = Muted, fontSize = 11.sp)
                Spacer(Modifier.height(6.dp))
                CompactButton(onClick = onBrowse, colors = ButtonDefaults.secondaryButtonColors(backgroundColor = Surface)) {
                    Icon(Icons.Filled.KeyboardArrowUp, contentDescription = "Choose a task", tint = Ink)
                }
                Text("Swipe up for tasks", color = Muted, fontSize = 10.sp)
            }
        }

        // footer: today + on hold + sync state
        val footer = buildList {
            if (r != null) add("Today ${Repo.fmtMins(repo.todayMinutes(now))}")
            if (held > 0) add("$held on hold")
            if (repo.status.isNotBlank()) add(repo.status)
        }.joinToString(" · ")
        if (footer.isNotEmpty()) {
            Text(
                footer, color = Muted, fontSize = 10.sp, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp, start = 40.dp, end = 40.dp),
            )
        }
    }
}

/* ---------- one task per page ---------- */

@Composable
private fun TaskPage(repo: Repo, c: Choice, onEdit: (String) -> Unit, onStarted: () -> Unit) {
    val color = repo.colorFor(c.name)
    val haptic = LocalHapticFeedback.current
    val open = repo.openFor(c.name)
    val pinned = repo.isPinned("task", c.name)
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.radialGradient(listOf(color.copy(alpha = 0.55f), color.copy(alpha = 0.12f), Color.Black))),
        contentAlignment = Alignment.Center,
    ) {
        // thin coloured rim
        Canvas(Modifier.fillMaxSize().padding(3.dp)) {
            drawCircle(color.copy(alpha = 0.8f), radius = size.minDimension / 2, style = Stroke(2.dp.toPx()))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 30.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (pinned) Icon(Icons.Filled.Star, null, tint = Ink, modifier = Modifier.size(11.dp).padding(end = 2.dp))
                Text(c.group.uppercase(), color = Ink.copy(alpha = 0.75f), fontSize = 10.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(2.dp))
            Text(
                c.name, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                maxLines = 3, overflow = TextOverflow.Ellipsis, lineHeight = 22.sp,
            )
            Text(c.sub, color = Ink.copy(alpha = 0.7f), fontSize = 11.sp, textAlign = TextAlign.Center, maxLines = 1)
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    repo.start(c)
                    onStarted()
                },
                colors = ButtonDefaults.primaryButtonColors(backgroundColor = Color.White),
                modifier = Modifier.size(56.dp),
            ) { PlayGlyph(26.dp, Color.Black) }
            if (open != null) Text("Resume", color = Ink.copy(alpha = 0.8f), fontSize = 10.sp, modifier = Modifier.padding(top = 2.dp))
        }
        CompactButton(
            onClick = { onEdit(c.name) },
            colors = ButtonDefaults.secondaryButtonColors(backgroundColor = Color.Black.copy(alpha = 0.45f)),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp),
        ) { Icon(Icons.Filled.Edit, contentDescription = "Edit ${c.name}", tint = Ink, modifier = Modifier.size(15.dp)) }
    }
}

/* ------------------------------------------------------------------ */
/*  Edit: a scrolling list you move with the crown                    */
/* ------------------------------------------------------------------ */

@Composable
private fun ListScreen(content: androidx.wear.compose.foundation.lazy.ScalingLazyListScope.() -> Unit) {
    val state = rememberScalingLazyListState()
    val focus = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
        positionIndicator = { PositionIndicator(scalingLazyListState = state) },
    ) {
        ScalingLazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize().background(Color.Black).crownScroll(state, focus, scope),
            autoCentering = AutoCenteringParams(itemIndex = 1),
            content = content,
        )
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}

@Composable
private fun EditScreen(repo: Repo, name: String, onFinish: (String) -> Unit, onLocation: () -> Unit, onDone: () -> Unit) {
    val open = repo.openFor(name)
    val choice = repo.choices().firstOrNull { it.name.equals(name, ignoreCase = true) }
    val color = repo.colorFor(name)
    val now = rememberNow()
    var confirmDiscard by remember { mutableStateOf(false) }
    val chipColors = ChipDefaults.secondaryChipColors(backgroundColor = Surface)

    ListScreen {
        item {
            ListHeader {
                Text(name, color = color, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        item {
            val info = when {
                open?.running == true -> "Running · ${Repo.clock(repo.elapsedMs(open, now))}"
                open != null -> "On hold · ${Repo.fmtMins((repo.elapsedMs(open, now) / 60000).toInt())} so far"
                else -> choice?.sub ?: ""
            }
            Text(info, color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
        when {
            open?.running == true -> item {
                Chip(
                    onClick = { repo.pause(); onDone() },
                    label = { Text("Pause") },
                    icon = { PauseGlyph(20.dp, Ink) },
                    colors = chipColors, modifier = Modifier.fillMaxWidth(),
                )
            }
            open != null -> item {
                Chip(
                    onClick = { repo.resume(open.id); onDone() },
                    label = { Text("Resume") },
                    icon = { PlayGlyph(20.dp, Ink) },
                    colors = ChipDefaults.primaryChipColors(backgroundColor = color), modifier = Modifier.fillMaxWidth(),
                )
            }
            choice != null -> item {
                Chip(
                    onClick = { repo.start(choice); onDone() },
                    label = { Text("Start") },
                    icon = { PlayGlyph(20.dp, Color.White) },
                    colors = ChipDefaults.primaryChipColors(backgroundColor = color), modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (open != null) {
            item {
                Chip(
                    onClick = { onFinish(open.id) },
                    label = { Text("Finish & save") },
                    secondaryLabel = { Text("Ask solo or help, then log it") },
                    icon = { StopGlyph(20.dp, Ink) },
                    colors = chipColors, modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        item {
            Chip(
                onClick = onLocation,
                label = { Text("Location") },
                secondaryLabel = { Text(repo.currentLocation.ifBlank { "Not set" }) },
                icon = { Icon(Icons.Filled.Place, null, tint = Ink) },
                colors = chipColors, modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            val pinned = repo.isPinned("task", name)
            Chip(
                onClick = { repo.togglePin("task", name) },
                label = { Text(if (pinned) "Unpin" else "Pin to top") },
                icon = { Icon(Icons.Filled.Star, null, tint = if (pinned) Accent else Ink) },
                colors = chipColors, modifier = Modifier.fillMaxWidth(),
            )
        }
        if (open != null) {
            item {
                Chip(
                    onClick = {
                        if (confirmDiscard) {
                            repo.discard(open.id)
                            onDone()
                        } else confirmDiscard = true
                    },
                    label = { Text(if (confirmDiscard) "Tap again to discard" else "Discard timer") },
                    secondaryLabel = { Text("Time won't be logged") },
                    icon = { Icon(Icons.Filled.Close, null, tint = Color(0xFFFF8A80)) },
                    colors = ChipDefaults.secondaryChipColors(backgroundColor = if (confirmDiscard) Color(0xFF5A1F1A) else Surface),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/* ---------- finish: solo / help, then save ---------- */

@Composable
private fun FinishScreen(repo: Repo, id: String, onDone: () -> Unit) {
    val a = repo.active.firstOrNull { it.id == id }
    if (a == null) {
        LaunchedEffect(Unit) { onDone() }
        return
    }
    var worked by remember { mutableStateOf(repo.lastWorked) }
    val planned = repo.plannedItemFor(a)
    var plannedDone by remember { mutableStateOf(planned?.optBoolean("done") ?: false) }
    val stints = repo.stints(a)
    val total = stints.sumOf { it.minutes }
    val color = repo.colorFor(a.task)
    val haptic = LocalHapticFeedback.current

    ListScreen {
        item { ListHeader { Text("Save time", fontWeight = FontWeight.Bold) } }
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text(a.task, color = color, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, maxLines = 2)
                Text(
                    "${Repo.fmtMins(total)}${if (stints.size > 1) " · ${stints.size} stretches" else " · ${stints.firstOrNull()?.start ?: ""}–${stints.firstOrNull()?.end ?: ""}"}",
                    color = Muted, fontSize = 12.sp,
                )
            }
        }
        listOf("Solo", "With help").forEach { option ->
            item {
                ToggleChip(
                    checked = worked == option,
                    onCheckedChange = { worked = option },
                    label = { Text(if (option == "Solo") "Solo" else "Had help") },
                    toggleControl = { RadioButton(selected = worked == option) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (planned != null) {
            item {
                ToggleChip(
                    checked = plannedDone,
                    onCheckedChange = { plannedDone = it },
                    label = { Text("Planned task finished") },
                    toggleControl = { Checkbox(checked = plannedDone) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        item {
            Chip(
                onClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    repo.finish(a.id, worked, if (planned != null) plannedDone else null)
                    onDone()
                },
                label = { Text("Save to log", fontWeight = FontWeight.Bold) },
                icon = { StopGlyph(20.dp, Color.White) },
                colors = ChipDefaults.primaryChipColors(backgroundColor = color),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/* ---------- location: pick a place (crown scrolls) ---------- */

@Composable
private fun LocationScreen(repo: Repo, onDone: () -> Unit) {
    val places = repo.locations()
    ListScreen {
        item { ListHeader { Text("Where are you?", fontWeight = FontWeight.Bold) } }
        item {
            Text(
                if (repo.running() != null) "Time from now counts here" else "New tasks get this place",
                color = Muted, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
            )
        }
        places.forEach { (name, sub) ->
            item {
                ToggleChip(
                    checked = repo.currentLocation.equals(name, ignoreCase = true),
                    onCheckedChange = { repo.setLocation(name); onDone() },
                    label = { Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = { Text(sub) },
                    toggleControl = { RadioButton(selected = repo.currentLocation.equals(name, ignoreCase = true)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (places.isEmpty()) {
            item {
                Text(
                    "No places yet. Add one on your phone (Today → 📍) and it shows up here.",
                    color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        item {
            Chip(
                onClick = { repo.setLocation(""); onDone() },
                label = { Text("No location") },
                colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
