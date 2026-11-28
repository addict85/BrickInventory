package ch.brickinventoryapp.app.widget

import android.content.Context
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalSize
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ch.brickinventoryapp.app.AppLockStore
import ch.brickinventoryapp.app.MainActivity
import ch.brickinventoryapp.data.AppearanceStore
import ch.brickinventoryapp.data.Credentials
import ch.brickinventoryapp.data.WidgetStatusStore
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.dataapi.finances.FinancesRepository
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.security.DeviceLock
import ch.brickinventoryapp.ui.components.AppLock
import ch.brickinventoryapp.ui.theme.Spacing
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.time.ZoneId
import java.util.concurrent.TimeUnit
/**
 * The most recently fetched numbers. The widget reads only here and thus shows the last state
 * even without network; only [WidgetWorker] fetches. Encrypted like the
 * other stores; a plaintext legacy stock counts as empty.
 */
internal object WidgetStore {
    /** The former own file; only kept for emptying, so that no old state is left lying around. */
    private const val OLD_FILE = "widget"

    private fun store(ctx: Context) = EntryPointAccessors.fromApplication(ctx, WidgetAccess::class.java).widgetStatusStore()

    fun read(ctx: Context): WidgetNumbers? = runCatching {
        store(ctx).widgetStatus()?.let { BrickJson.decodeFromString(WidgetNumbers.serializer(), it) }
    }.getOrNull()

    fun clearAll(ctx: Context) {
        store(ctx).emptyWidgetStatus()
        ctx.deleteSharedPreferences(OLD_FILE)
    }

    fun write(ctx: Context, z: WidgetNumbers) = store(ctx).setWidgetStatus(BrickJson.encodeToString(WidgetNumbers.serializer(), z))
}

/**
 * What Glance widget and store need outside of Hilt. A widget has no
 * constructor Hilt could fill; there the EntryPoint is the intended way.
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface WidgetAccess {
    fun credentials(): Credentials
    fun appearance(): AppearanceStore
    fun widgetStatusStore(): WidgetStatusStore
}

/**
 * Fetches the numbers hourly via the repositories — with their disk storage
 * as fallback when the server is silent.
 */
@HiltWorker
class WidgetWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val finances: FinancesRepository,
    private val access: Credentials,
    private val lock: DeviceLock,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): androidx.work.ListenableWorker.Result =
        if (catchUnlessCancelled { refresh(applicationContext) }.getOrDefault(false)) androidx.work.ListenableWorker.Result.success()
        else androidx.work.ListenableWorker.Result.retry()

    /** false: once more later. */
    private suspend fun refresh(ctx: Context): Boolean {
        // Signed out there is nothing to show; the old state would otherwise stay visible to others.
        if (access.tokenNow().isBlank()) {
            if (withoutToken(lock.locked()) == WithoutToken.LATER) return false
            WidgetStore.clearAll(ctx)
            CollectionWidget().updateAll(ctx)
            return true
        }
        val pnl = finances.getPnl()
        val history = finances.getPortfolioHistory("week")
        // Both failed: keep the last numbers and let WorkManager try again; one alone is enough to show.
        if (pnl is Outcome.Failure && history is Outcome.Failure) return false
        val pnlData = when (pnl) { is Outcome.Success -> pnl.data; is Outcome.Failure -> null }
        val historyData = when (history) { is Outcome.Success -> history.data; is Outcome.Failure -> null }
        widgetNumbers(pnlData, historyData, System.currentTimeMillis())?.let { WidgetStore.write(ctx, it) }
        CollectionWidget().updateAll(ctx)
        return true
    }

    companion object {
        private const val NAME = "sammlungs-widget"

        fun schedule(ctx: Context) = runCatching {
            val job = PeriodicWorkRequestBuilder<WidgetWorker>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, job)
        }

        fun unsubscribe(ctx: Context) = runCatching { WorkManager.getInstance(ctx).cancelUniqueWork(NAME) }
    }
}

/** What the widget shows: title, value, the two P&L rows, when they are from and whether dimmed. */
internal class WidgetContent(
    val title: String,
    val empty: String,
    val value: Pair<String, String>?,
    val rows: List<Pair<String, String>>,
    val stamp: String?,
    val stale: Boolean,
)

/** Collection value, P&L today and in total; a tap opens the app. */
class CollectionWidget : GlanceAppWidget() {
    // Glance lays out for the largest size that fits: small only the value, from the default
    // size on both P&L rows, tall with the label and a larger value.
    override val sizeMode = SizeMode.Responsive(setOf(SMALL, MEDIUM, TALL))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val access = runCatching { EntryPointAccessors.fromApplication(context, WidgetAccess::class.java) }.getOrNull()
        val loggedIn = catchUnlessCancelled { access?.credentials()?.tokenNow()?.isNotBlank() == true }.getOrDefault(false)
        // Money values only if the user allows them on the home screen and the app lock does not apply.
        val show = access?.appearance()?.showWidgetValues() == true &&
            !AppLock.hiddenWidget(AppLockStore(context))
        val numbers = widgetDisplay(WidgetStore.read(context), loggedIn)
        // The texts in the app's language, not the system's (LanguageManager).
        val ctx = LanguageManager.localizedContext(context)
        val content = widgetContent(ctx, numbers, show, System.currentTimeMillis(), ZoneId.systemDefault())
        provideContent { GlanceTheme { Content(content) } }
    }

    @Composable
    private fun Content(c: WidgetContent) {
        val size = LocalSize.current
        val wide = size.width >= MEDIUM.width
        val rows = wide && size.height >= MEDIUM.height
        val tall = rows && size.height >= TALL.height
        val colors = GlanceTheme.colors
        // Old numbers in the secondary color: still there, but not to be read as today's.
        val main = if (c.stale) colors.onSurfaceVariant else colors.onSurface
        val stamp = @Composable { text: String ->
            Text(text, maxLines = 1, style = TextStyle(fontSize = Type.labelSmall.fontSize, color = colors.onSurfaceVariant))
        }
        Column(
            GlanceModifier.fillMaxSize().background(colors.widgetBackground)
                .cornerRadius(16.dp).padding(Spacing.medium).clickable(actionStartActivity<MainActivity>()),
        ) {
            Row(GlanceModifier.fillMaxWidth()) {
                Text(c.title, GlanceModifier.defaultWeight(), maxLines = 1,
                    style = TextStyle(fontWeight = FontWeight.Bold, fontSize = Type.titleSmall.fontSize, color = colors.onSurface))
                if (wide) c.stamp?.let { stamp(it) }
            }
            Spacer(GlanceModifier.height(Spacing.tiny))
            val value = c.value
            if (value == null) {
                Text(c.empty, style = TextStyle(fontSize = Type.bodySmall.fontSize, color = colors.onSurfaceVariant))
                return@Column
            }
            if (tall) Text(value.first, style = TextStyle(fontSize = Type.labelMedium.fontSize, color = colors.onSurfaceVariant))
            Text(value.second, maxLines = 1,
                style = TextStyle(fontSize = (if (tall) Type.headlineSmall else Type.titleMedium).fontSize,
                    fontWeight = FontWeight.Medium, color = main))
            if (rows) for ((name, amount) in c.rows) {
                Row(GlanceModifier.fillMaxWidth()) {
                    Text(name, GlanceModifier.defaultWeight(), maxLines = 1,
                        style = TextStyle(fontSize = Type.bodySmall.fontSize, color = colors.onSurfaceVariant))
                    Text(amount, maxLines = 1,
                        style = TextStyle(fontSize = Type.bodySmall.fontSize, fontWeight = FontWeight.Medium, color = main))
                }
            }
            if (!wide) c.stamp?.let { stamp(it) }
        }
    }

    private companion object {
        val SMALL = DpSize(110.dp, 60.dp)
        val MEDIUM = DpSize(180.dp, 100.dp)
        val TALL = DpSize(180.dp, 150.dp)

        /** Material's type scale: Glance has none of its own, and the app's sizes follow it. */
        val Type = Typography()
    }
}

/** The texts of the widget in the app's language; signed out or never fetched, the hint to open the app. */
internal fun widgetContent(ctx: Context, numbers: WidgetNumbers?, show: Boolean, now: Long, zone: ZoneId): WidgetContent {
    val title = ctx.getString(R.string.widget_title)
    if (numbers == null) return WidgetContent(title, ctx.getString(R.string.widget_empty), null, emptyList(), null, false)
    val (value, today, total) = widgetValues(numbers, show)
    val age = widgetAge(numbers.state, now, zone, ctx.resources.configuration.locales[0])
    return WidgetContent(title, "", ctx.getString(R.string.widget_value) to value,
        listOf(ctx.getString(R.string.widget_today) to today, ctx.getString(R.string.widget_total) to total),
        age.stamp?.let { ctx.getString(R.string.widget_as_of, it) }, age.stale)
}

/** Registers the widget with Android; updating begins with the first widget. */
class CollectionWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CollectionWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        WidgetWorker.schedule(context)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        WidgetWorker.unsubscribe(context)
    }
}
