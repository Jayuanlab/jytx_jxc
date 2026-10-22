(function () {
  const validPhone = (value) => /^1[3-9]\d{9}$/.test(value);
  function feedback(control, message, kind) {
    const field = control.closest('.field');
    if (!field) return;
    let note = field.querySelector('.field-feedback');
    if (!note) {
      note = document.createElement('p');
      note.className = 'field-feedback';
      note.setAttribute('role', 'status');
      field.append(note);
    }
    note.textContent = message;
    note.dataset.kind = kind;
    control.setAttribute('aria-invalid', kind === 'error' ? 'true' : 'false');
  }
  function attach(form, getItems, getReceptions) {
    function check(focusFirst = false) {
      const phone = form.elements.customerPhone;
      const reception = form.elements.receptionId;
      const mode = form.elements.saleMode;
      let firstError = null;
      function flag(control, message, kind) {
        feedback(control, message, kind);
        if (kind === 'error' && !firstError) firstError = control;
      }
      const phoneValue = phone.value.trim();
      flag(phone, !phoneValue ? '' : validPhone(phoneValue) ? '✓ 手机号格式正确' : '请填写正确的 11 位手机号，或留空。', !phoneValue ? 'hint' : validPhone(phoneValue) ? 'good' : 'error');
      const linked = getReceptions().find((row) => row.id === reception.value);
      const linkedPhone = linked?.customerPhone || '';
      flag(reception, linked && phoneValue && linkedPhone !== phoneValue ? '所填手机号与接待单不一致，请核对。' : linked ? '✓ 已关联接待单，开单后会记录在顾客历程。' : '', linked && phoneValue && linkedPhone !== phoneValue ? 'error' : linked ? 'good' : 'hint');
      const items = getItems();
      const itemNote = document.getElementById('sale-item-feedback');
      if (itemNote) {
        itemNote.textContent = items.length ? `✓ 已加入 ${items.length} 行商品，请核对数量和售价。` : focusFirst ? '请先加入至少一件商品。' : '';
        itemNote.dataset.kind = items.length ? 'good' : focusFirst ? 'error' : 'hint';
      }
      if (!items.length && !firstError) firstError = document.getElementById('sale-search');
      const gov = mode.value === 'guobu';
      const platform = form.elements.platformOrderNo;
      const subsidy = form.elements.subsidyAmount;
      if (gov) {
        const one = items.length === 1 && Number(items[0].quantity) === 1;
        const productPrice = one ? Number(items[0].salePrice) : 0;
        const maximum = Math.min(Math.round(productPrice * 15) / 100, 500);
        const amount = Number(subsidy.value);
        flag(platform, platform.value.trim() ? '✓ 已填写平台交易号' : '国补销售须填写平台交易号。', platform.value.trim() ? 'good' : 'error');
        flag(subsidy, !one ? '国补商品须一件单独开单。' : productPrice <= 0 || productPrice > 6000 ? '国补商品成交价须大于 0 且不超过 6000 元。' : !Number.isFinite(amount) || amount <= 0 || amount > maximum ? `补贴金额须大于 0，且不超过 ${maximum.toFixed(2)} 元。` : '✓ 补贴金额在本单上限内', !one || productPrice <= 0 || productPrice > 6000 || !Number.isFinite(amount) || amount <= 0 || amount > maximum ? 'error' : 'good');
      } else {
        feedback(platform, '', 'hint');
        feedback(subsidy, '', 'hint');
      }
      if (focusFirst && firstError) {
        for(let section=firstError.parentElement;section;section=section.parentElement)if(section.tagName==='DETAILS')section.open=true;
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstError.focus({ preventScroll: true });
      }
      return !firstError;
    }
    form.addEventListener('input', () => check());
    form.addEventListener('change', () => check());
    check();
    function showFailure(message){const box=document.getElementById('sale-submit-feedback');if(!box)return;box.hidden=false;box.dataset.kind='error';box.textContent='销售单未提交成功：'+message;box.scrollIntoView({behavior:'smooth',block:'center'});}
    function clearFailure(){const box=document.getElementById('sale-submit-feedback');if(box){box.hidden=true;box.textContent='';}}
    return { check, showFailure, clearFailure };
  }
  function showSuccess(sale, next) {
    document.getElementById('sale-success-dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'sale-success-dialog';
    const heading = document.createElement('h2');
    heading.textContent = '✓ 销售单提交成功';
    const number = document.createElement('p');
    number.className = 'success-order-number';
    number.textContent = `单号：${sale.displayNo||sale.number||sale.id}`;
    const detail = document.createElement('p');
    detail.textContent = `${sale.paymentReview?.status || '收款待核对'}${sale.giftApprovalIds?.length ? '；赠品超限待审批' : ''}。`;
    const actions = document.createElement('div');
    actions.className = 'success-actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '查看销售单';
    const again = document.createElement('button');
    again.type = 'button';
    again.textContent = '开下一单';
    close.addEventListener('click', () => dialog.close());
    again.addEventListener('click', () => { dialog.close(); next(); });
    actions.append(close, again);
    dialog.append(heading, number, detail, actions);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
  }
  window.SaleFeedback = { attach, showSuccess };
})();
