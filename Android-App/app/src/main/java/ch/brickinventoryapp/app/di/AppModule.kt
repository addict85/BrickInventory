package ch.brickinventoryapp.app.di

import android.content.Context
import androidx.glance.appwidget.updateAll
import ch.brickinventoryapp.BuildConfig
import ch.brickinventoryapp.app.MessageEntryPoint
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.data.StartDestination
import ch.brickinventoryapp.state.ui.LogoutHook
import ch.brickinventoryapp.app.widget.CollectionWidget
import ch.brickinventoryapp.app.widget.WidgetStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import ch.brickinventoryapp.state.ui.WidgetKick

/**
 * What only the app knows: its activity and its widget. The modules below see
 * only the interfaces of it, otherwise the data layer would depend on the app.
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    /**
     * The non-exported entry, not MainActivity: only it accepts a target.
     * The class itself, not its name: for R8 only a class reference is a call.
     */
    @Provides
    fun provideStartDestination(): StartDestination = StartDestination(MessageEntryPoint::class.java)

    @Provides
    fun provideAppVersion(): AppVersion = AppVersion(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE)

    /** Otherwise after sign-out the widget shows the numbers of the old account. */
    @Provides
    fun provideWidgetKick(@ApplicationContext ctx: Context): WidgetKick =
        WidgetKick { CollectionWidget().updateAll(ctx) }

    @Provides
    fun provideLogoutHook(@ApplicationContext ctx: Context): LogoutHook = LogoutHook {
        WidgetStore.clearAll(ctx)
        CollectionWidget().updateAll(ctx)
    }
}
