'use strict';

// Resolve from the persisted source ID so a business message opens its own record.
function target(store, notice) {
  const id = String(notice.orderId || notice.redPacketId || notice.requestId || '');
  const kind = String(notice.kind || '');
  const has = collection => id && (store[collection] || []).some(row => row.id === id);
  const q = encodeURIComponent(id);
  if(kind==='员工签到提醒'&&has('attendance'))return '/assistant?work-signin=1';
  if (has('storeCashWalletTransfers')) return '/store-transfer?id='+q;
  if (has('businessReconciliations')) return '/business-reconciliation?id='+q;
  if (has('inventoryLossCases')) return '/business-reconciliation?loss='+q;
  if (has('paymentRequests')&&(store.paymentRequests||[]).find(row=>row.id===id)?.policy==='normal_business_then_owner_reconciliation_v120') return '/business-reconciliation?request='+q;
  if ((store.otherIncome||[]).some(row=>row.id===id&&row.reconciliation)) return '/app?tab=receipts&sourceId=' + q;
  if (has('otherIncome')) return '/app?tab=receipts&sourceId=' + q;
  if (has('airFundingOrders')) return '/air-recharge?funding=' + q;
  if (has('airRechargeEvents')) return '/air-recharge?event=' + q;
  if (has('cardBusinesses')) return '/app?tab=cards&q=' + q;
  if (has('carrierServices')) return '/carrier?service=' + q;
  if (/红包/.test(kind) && has('orderRedPackets')) return '/order-red-packets?request=' + q;
  if (has('saleReturnRequests')) return '/app?tab=returns&focusSaleReturn=' + q + '#sale-return-requests';
  if (has('purchaseReturnRequests')) return '/app?tab=purchase&focusPurchaseReturn=' + q + '#purchase-return-requests';
  if (has('sales')) return '/sale-payments?order=' + q;
  if (has('procurementPlans')) return '/app?tab=purchase&q=' + q + '&focusPlan=' + q;
  if (has('purchases')) return '/app?tab=purchase-query&q=' + q;
  if (has('cashHandovers')) return '/cash-handover?handover=' + q;
  if (has('fundTransfers')) return '/funds?transfer=' + q;
  if (has('dailyCloseouts')) return '/daily-close?closeout=' + q;
  if (has('closeouts')) return '/close?closeout=' + q;
  if (has('leaveRequests')) return '/personnel?leave=' + q;
  if (has('learningRecords')) return '/learning?record=' + q;
  if (has('openingImportDrafts')) return '/opening-drafts?draft=' + q;
  if (has('airOpeningDrafts')) return '/air-recharge?draft=' + q;
  if (has('catalogAdditionReviews')) return '/master-data?review=' + q;
  if (/红包/.test(kind) && /^HB-[a-zA-Z0-9-]+$/.test(id)) return '/order-red-packets?request=' + q;
  if (/销售.*退货|销售.*换货|^退货|^换货/.test(kind) && id) return '/app?tab=returns&focusSaleReturn=' + q + '#sale-return-requests';
  if (/销售|收款/.test(kind) && id) return '/sale-payments?order=' + q;
  if (/订货/.test(kind) && id) return '/app?tab=purchase&q=' + q + '&focusPlan=' + q;
  if (/采购|进货/.test(kind) && id) return '/app?tab=purchase-query&q=' + q;
  return '/notices';
}

module.exports = { target };
