package ch.brickinventoryapp.model.util

import java.util.concurrent.CopyOnWriteArrayList
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What holds key material or the token in memory registers here. When the device locks
 * (screen off with a secure lock screen) everything is dropped; whoever reads out the RAM
 * of a locked phone then finds ciphertext only. [restore] runs after unlocking for holders
 * that cannot reload lazily (the token mirror of the interceptor).
 */
@Singleton
class LockWipe @Inject constructor() {
    private class Holder(val wipe: () -> Unit, val restore: () -> Unit)

    private val holders = CopyOnWriteArrayList<Holder>()

    fun register(wipe: () -> Unit, restore: () -> Unit = {}) {
        holders += Holder(wipe, restore)
    }

    // One failing holder must not keep the others' secrets in memory; the failure itself only
    // means that holder reloads lazily, so there is nothing to report.
    fun wipe() = holders.forEach { h -> catchUnlessCancelled { h.wipe() } }

    fun restore() = holders.forEach { h -> catchUnlessCancelled { h.restore() } }
}
