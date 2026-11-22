package ch.brickinventoryapp.app.testing

import android.content.Context
import android.content.pm.ActivityInfo
import androidx.activity.ComponentActivity
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.test.core.app.ApplicationProvider
import dagger.hilt.android.ViewModelLifecycle
import dagger.hilt.android.components.ViewModelComponent
import dagger.hilt.android.internal.builders.ViewModelComponentBuilder
import dagger.hilt.android.internal.lifecycle.HiltViewModelFactory
import dagger.hilt.internal.GeneratedComponent
import dagger.hilt.internal.GeneratedComponentManager
import org.junit.rules.ExternalResource
import org.robolectric.Shadows.shadowOf
import java.lang.reflect.Proxy
import javax.inject.Provider

/**
 * The test's ViewModels, handed to `hiltViewModel()` in the destinations: Hilt's factory asks the
 * activity for its entry points, and here they answer from [put] instead of a generated component.
 * So the graphs run as in the app, without Hilt's test artifacts.
 */
class ViewModelFactories {
    private val makers = mutableMapOf<Class<*>, (SavedStateHandle) -> ViewModel>()

    /** Every ViewModel the destinations asked for, in order; a test checks against it. */
    val created = mutableListOf<ViewModel>()

    fun <T : ViewModel> put(type: Class<T>, make: (SavedStateHandle) -> T) { makers[type] = make }

    inline fun <reified T : ViewModel> put(noinline make: (SavedStateHandle) -> T) = put(T::class.java, make)

    private inner class Component(private val handle: SavedStateHandle) :
        ViewModelComponent, GeneratedComponent, HiltViewModelFactory.ViewModelFactoriesEntryPoint {
        override fun getHiltViewModelMap(): Map<Class<*>, Provider<ViewModel>> =
            makers.mapValues { (_, make) -> Provider { make(handle).also { created += it } } }
        override fun getHiltViewModelAssistedMap(): Map<Class<*>, Any> = emptyMap()
    }

    private inner class Builder : ViewModelComponentBuilder {
        private var handle = SavedStateHandle()
        override fun savedStateHandle(handle: SavedStateHandle): ViewModelComponentBuilder = apply { this.handle = handle }
        override fun viewModelLifecycle(lifecycle: ViewModelLifecycle): ViewModelComponentBuilder = this
        override fun build(): ViewModelComponent = Component(handle)
    }

    /** Hilt's activity entry point is package-private; a proxy implements it all the same. */
    internal fun activityEntryPoint(): Any {
        val entryPoint = Class.forName("dagger.hilt.android.internal.lifecycle.HiltViewModelFactory\$ActivityCreatorEntryPoint")
        return Proxy.newProxyInstance(entryPoint.classLoader, arrayOf(entryPoint, GeneratedComponent::class.java)) { _, method, _ ->
            when (method.name) {
                "getViewModelKeys" -> makers.keys.associateWith { true }
                "getViewModelComponentBuilder" -> Builder()
                else -> error("unexpected entry point call ${method.name}")
            }
        }
    }
}

/** The activity the destinations find as their Hilt entry point. */
class HiltTestActivity : ComponentActivity(), GeneratedComponentManager<Any> {
    var viewModels = ViewModelFactories()
    override fun generatedComponent(): Any = viewModels.activityEntryPoint()
}

/** Robolectric starts only activities the package knows; the test activity is not in the app's manifest. */
class RegisterHiltTestActivity : ExternalResource() {
    override fun before() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        shadowOf(ctx.packageManager).addOrUpdateActivity(ActivityInfo().apply {
            name = HiltTestActivity::class.java.name
            packageName = ctx.packageName
        })
    }
}
