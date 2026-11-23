package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.VoucherPlaintext
import ch.brickinventoryapp.model.domain.PlaintextView

fun VoucherPlaintext.asView() = PlaintextView(id, number, pin)
