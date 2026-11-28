package ch.brickinventoryapp.app.di

import android.app.Activity
import android.content.Context
import android.os.SystemClock
import android.widget.Toast
import androidx.fragment.app.FragmentActivity
import ch.brickinventoryapp.app.AppLockStore
import ch.brickinventoryapp.app.devicesStarts
import ch.brickinventoryapp.dataapi.language.AppLanguage
import ch.brickinventoryapp.model.step.StepBinding
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.AppLock
import ch.brickinventoryapp.ui.components.DevicesStepProtection
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.components.ActivityComponent
import dagger.hilt.android.qualifiers.ActivityContext
import dagger.hilt.android.scopes.ActivityScoped

/**
 * App lock and step guard per activity, as Hilt builds them: the lock's state lives in its
 * sealed store, so a recreated activity sees the same lock; the guard needs the activity
 * for the biometric prompt and its toasts.
 */
@Module
@InstallIn(ActivityComponent::class)
internal object ActivityModule {

    @Provides
    @ActivityScoped
    fun appLockStore(@ActivityContext context: Context): AppLock.Store = AppLockStore(context)

    @Provides
    @ActivityScoped
    fun appLock(store: AppLock.Store, @ActivityContext context: Context): AppLock =
        AppLock(SystemClock::elapsedRealtime, store) { devicesStarts(context) }

    /** Toasts in the app language: below Android 13 the activity carries the system's. */
    @Provides
    @ActivityScoped
    fun stepGuard(activity: Activity, binding: StepBinding, appLanguage: AppLanguage): DevicesStepProtection {
        fun text(id: Int) = appLanguage.localizedContext(activity).getString(id)
        fun toast(text: String) = Toast.makeText(activity, text, Toast.LENGTH_LONG).show()
        return DevicesStepProtection(
            activity as FragmentActivity,
            noKey = { toast(text(R.string.step_no_key)) },
            binding = binding,
            // The server's sentence says what to do (sign in again, set up a screen lock).
            declined = { message -> toast(message ?: text(R.string.step_server_error)) },
            withoutAttestation = { toast(text(R.string.step_without_attestation)) },
        ) { text(R.string.step_subtitle) }
    }
}
