package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.data.LogoutPath
import ch.brickinventoryapp.data.LogoutState
import ch.brickinventoryapp.data.SessionCleanup
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.session.LogoutProcess
import ch.brickinventoryapp.session.Session
import javax.inject.Inject

/**
 * The order of signing out: first the server revokes the token (on a
 * server change that's still the old server), then the data layer cleans up the device,
 * and finally widget, session and Blickfeld clear their state.
 */
class Logout @Inject constructor(
    private val cleanup: SessionCleanup,
    private val logoutHook: LogoutHook,
    private val session: Session,
    private val viewport: Scope,
    private val logoutState: LogoutState,
) : LogoutProcess {
    /** Reports whether the server revokes the token only later (from the queue). */
    override suspend fun execute(): LogoutPath? {
        val gone = if (session.state.value.isLoggedIn) logoutState.atServer() else null
        cleanup.cleanUp()
        // Otherwise the widget would keep showing the signed-out account's numbers.
        catchUnlessCancelled { logoutHook.loggedOut() }
        session.loggedOut()
        viewport.reset()
        return gone
    }
}
