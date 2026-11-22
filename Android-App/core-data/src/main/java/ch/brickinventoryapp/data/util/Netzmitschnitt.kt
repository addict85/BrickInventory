package ch.brickinventoryapp.data.util

import ch.brickinventoryapp.network.util.Protokoll
import okhttp3.logging.HttpLoggingInterceptor

/**
 * The network log of the debug build: only request and status line, never bodies
 * (passwords, voucher PINs). The headers with token or session are additionally
 * redacted in case someone raises the level while searching.
 */
internal fun networkRecording(
    schreiber: HttpLoggingInterceptor.Logger = HttpLoggingInterceptor.Logger { Protokoll.notiz("OkHttp", it) },
): HttpLoggingInterceptor = HttpLoggingInterceptor(schreiber).apply {
    level = HttpLoggingInterceptor.Level.BASIC
    redactHeader("Authorization")
    redactHeader("Cookie")
    redactHeader("Set-Cookie")
}
