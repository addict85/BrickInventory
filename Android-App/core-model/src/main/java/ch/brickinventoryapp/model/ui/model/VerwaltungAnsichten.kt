package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.fach.Laufstatus

// Jobs, Brickset-Warteschlange, Zwischenspeicher und Kontingente im Monitoring.

data class JobZustandAnsicht(
    val label: String = "",
    val status: Laufstatus = Laufstatus.RUHT,
    val progress: Int = 0,
    val total: Int = 0,
    val sub: String? = null,
)

data class ZeitplanAnsicht(
    val type: String = "daily",
    val time: String? = null,
    val minutes: Int? = null,
)

data class BricksetEintragAnsicht(
    val setNumber: String,
    val name: String? = null,
    val attempts: Int = 0,
    val retryAfter: String? = null,
    val lastError: String? = null,
)

data class CacheKennzahlenAnsicht(
    val prices: Int = 0,
    val subsets: Int = 0,
    val catalog: Int = 0,
    val priceStale: Int = 0,
    val rateLimits: KontingenteAnsicht? = null,
)

data class KontingenteAnsicht(
    val bricklink: KontingentAnsicht = KontingentAnsicht(),
    val rebrickable: KontingentAnsicht = KontingentAnsicht(),
    val brickset: KontingentAnsicht = KontingentAnsicht(),
)

data class KontingentAnsicht(
    val count: Int = 0,
    val limit: Int = 0,
    val remaining: Int = 0,
)

data class ApiGrenzenAnsicht(
    val rebrickable: Int = 0,
    val bricklink: Int = 0,
    val brickset: Int = 0,
)
