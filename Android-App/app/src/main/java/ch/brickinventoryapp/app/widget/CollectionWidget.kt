package ch.brickinventoryapp.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
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
import ch.brickinventoryapp.data.finances.FinancesRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.util.LanguageManager
import ch.brickinventoryapp.model.json.BrickJson
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
        val pnl = (finances.getPnl() as? Outcome.Success)?.data
        val history = (finances.getPortfolioHistory("week") as? Outcome.Success)?.data
        widgetNumbers(pnl, history, System.currentTimeMillis())?.let { WidgetStore.write(ctx, it) }
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

/** Collection value, P&L today and in total; a tap opens the app. */
class CollectionWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val access = runCatching { EntryPointAccessors.fromApplication(context, WidgetAccess::class.java) }.getOrNull()
        val loggedIn = catchUnlessCancelled { access?.credentials()?.tokenNow()?.isNotBlank() == true }.getOrDefault(false)
        // Money values only if the user allows them on the home screen and the app lock does not apply.
        val show = access?.appearance()?.showWidgetValues() == true &&
            !AppLock.hiddenWidget(AppLockStore(context))
        val numbers = widgetDisplay(WidgetStore.read(context), loggedIn)
        // The texts in the app's language, not the system's (LanguageManager).
        val ctx = LanguageManager.localizedContext(context)
        val title = ctx.getString(R.string.widget_title)
        val rows = numbers?.let {
            val (value, today, total) = widgetValues(it, show)
            listOf(
                ctx.getString(R.string.widget_value) to value,
                ctx.getString(R.string.widget_today) to today,
                ctx.getString(R.string.widget_total) to total,
            )
        }
        val empty = ctx.getString(R.string.widget_empty)
        provideContent { GlanceTheme { Content(title, rows, empty) } }
    }

    @Composable
    private fun Content(title: String, rows: List<Pair<String, String>>?, empty: String) {
        Column(
            GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground)
                .cornerRadius(16.dp).padding(Spacing.medium).clickable(actionStartActivity<MainActivity>()),
        ) {
            Text(title, style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 14.sp, color = GlanceTheme.colors.onSurface))
            Spacer(GlanceModifier.height(6.dp))
            if (rows == null) {
                Text(empty, style = TextStyle(fontSize = 12.sp, color = GlanceTheme.colors.onSurfaceVariant))
            } else for ((name, value) in rows) {
                Text(name, style = TextStyle(fontSize = 12.sp, color = GlanceTheme.colors.onSurfaceVariant))
                Text(value, style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = GlanceTheme.colors.onSurface))
            }
        }
    }
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
