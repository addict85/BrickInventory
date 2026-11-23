package ch.brickinventoryapp.data.util

import ch.brickinventoryapp.network.util.AppLog
import okhttp3.logging.HttpLoggingInterceptor

/**
 * The network log of the debug build: only request and status line, never bodies
 * (passwords, voucher PINs). The headers with token or session are additionally
 * redacted in case someone raises the level while searching.
 */
internal fun networkRecording(
    writer: HttpLoggingInterceptor.Logger = HttpLoggingInterceptor.Logger { AppLog.note("OkHttp", it) },
): HttpLoggingInterceptor = HttpLoggingInterceptor(writer).apply {
    level = HttpLoggingInterceptor.Level.BASIC
    redactHeader("Authorization")
    redactHeader("Cookie")
    redactHeader("Set-Cookie")
}
