"""Build a clearly marked, deterministic ERP test batch from store exports.

Usage: python scripts/prepare-erp-test-batch.py CATALOG.xlsb SERIALS.xls STOCK.xlsx OUTPUT.json
Requires pyxlsb, xlrd and openpyxl. This script only writes local JSON.
"""
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl
import xlrd
from pyxlsb import open_workbook


def txt(value):
    return str(value).strip() if value is not None else ""


def val(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def read_catalog(path):
    with open_workbook(str(path)) as book:
        with book.get_sheet(1) as sheet:
            rows = [[cell.v for cell in row] for row in sheet.rows()]
    names = [txt(x) for x in rows[0]]
    result = {}
    for line, raw in enumerate(rows[1:], 2):
        row = dict(zip(names, raw))
        code = txt(row.get("商品编号"))
        if not code:
            continue
        if code in result:
            raise ValueError(f"商品编号重复：{code}")
        row["sourceLine"] = line
        result[code] = row
    return result


def read_serials(path):
    sheet = xlrd.open_workbook(str(path)).sheet_by_index(0)
    names = [txt(x) for x in sheet.row_values(5)]
    result = []
    seen = set()
    for index in range(6, sheet.nrows):
        row = dict(zip(names, sheet.row_values(index)))
        if not isinstance(row.get("行号"), (int, float)):
            continue
        serial = txt(row.get("序列号"))
        code = txt(row.get("商品编号"))
        if not serial or not code:
            continue
        if serial in seen:
            raise ValueError(f"串码重复，Excel 第 {index + 1} 行")
        seen.add(serial)
        result.append((code, serial))
    return result


def read_stock(path):
    sheet = openpyxl.load_workbook(path, read_only=True, data_only=True).active
    headers = None
    result = {}
    for line, raw in enumerate(sheet.iter_rows(values_only=True), 1):
        labels = [txt(x) for x in raw]
        if headers is None:
            if "商品编号" in labels and "库存数量" in labels:
                headers = labels
            continue
        row = dict(zip(headers, raw))
        if not isinstance(row.get("行号"), (int, float)):
            continue
        code = txt(row.get("商品编号"))
        if code and val(row.get("库存数量")) > 0:
            if code in result:
                raise ValueError(f"旧库存表商品编号重复：{code}")
            result[code] = row
    if headers is None:
        raise ValueError("旧库存表未找到表头")
    return result


def choose_price(product, stock=None, accessory=False):
    options = (
        [("旧库存预设售价", stock.get("预设售价") if stock else 0)] if accessory else []
    ) + [
        ("商品预设售价1", product.get("预设售价1")),
        ("商品零售价", product.get("零售价")),
    ]
    for source, amount in options:
        if val(amount) > 0:
            return round(val(amount), 2), source
    if accessory and stock and val(stock.get("成本均价")) > 0:
        return max(1, round(val(stock["成本均价"]) * 1.4, 2)), "按成本均价生成的测试售价"
    return None, "缺少售价"


def base_product(code, source, quantity, price, price_source, cost, serials):
    category = txt(source.get("一级分类"))
    major = {"智能手机": "智能机", "旧手机": "二手机"}.get(category, category)
    source_name = txt(source.get("商品全名"))
    if not source_name:
        raise ValueError(f"商品名称为空：{code}")
    unit = txt(source.get("基本单位")) or ({"智能机": "台", "功能机": "台", "二手机": "台", "号卡": "张", "手表": "只"}.get(major, "件"))
    sku_id = "sku-test-" + hashlib.sha256(code.encode("utf-8")).hexdigest()[:20]
    return {
        "skuId": sku_id,
        "externalCode": code,
        "name": "【测试】" + source_name,
        "shortName": txt(source.get("简名")) or source_name,
        "type": major,
        "subType": txt(source.get("二级分类")),
        "thirdType": "",
        "sourceCategory3": txt(source.get("三级分类")),
        "spec": txt(source.get("规格")) or txt(source.get("型号")),
        "unit": unit,
        "quantity": quantity,
        "costPrice": round(cost, 4),
        "salePrice": round(price, 2),
        "priceSource": price_source,
        "testPriceGenerated": price_source == "按成本均价生成的测试售价",
        "trackSerial": bool(serials),
        "serials": sorted(serials),
    }


def build(catalog_path, serial_path, stock_path):
    catalog = read_catalog(catalog_path)
    serial_rows = read_serials(serial_path)
    stock = read_stock(stock_path)
    serial_by_code = defaultdict(list)
    for code, serial in serial_rows:
        serial_by_code[code].append(serial)
    products = []
    skipped = Counter()
    for code, serials in sorted(serial_by_code.items()):
        product = catalog.get(code)
        if product is None:
            skipped["串码商品未匹配商品列表"] += len(serials)
            continue
        if txt(product.get("序列号管理")) != "启用":
            skipped["商品档案未启用序列号管理"] += len(serials)
            continue
        price, source = choose_price(product)
        if price is None:
            skipped["串码商品没有有效售价"] += len(serials)
            continue
        cost = val(product.get("参考成本价"))
        if cost <= 0:
            skipped["串码商品没有有效成本"] += len(serials)
            continue
        products.append(base_product(code, product, len(serials), price, source, cost, serials))
    for code, row in sorted(stock.items()):
        product = catalog.get(code)
        if not product or txt(product.get("一级分类")) != "配件" or code in serial_by_code:
            continue
        quantity = val(row.get("库存数量"))
        if not quantity.is_integer():
            skipped["配件库存数量不是整数"] += 1
            continue
        cost = val(row.get("成本均价"))
        if cost <= 0:
            skipped["配件没有有效成本"] += 1
            continue
        price, source = choose_price(product, row, accessory=True)
        products.append(base_product(code, product, int(quantity), price, source, cost, []))
    codes = [p["externalCode"] for p in products]
    ids = [p["skuId"] for p in products]
    if len(set(codes)) != len(codes) or len(set(ids)) != len(ids):
        raise ValueError("测试商品编号或 SKU ID 重复")
    for p in products:
        if p["quantity"] <= 0 or p["salePrice"] <= 0 or p["costPrice"] <= 0:
            raise ValueError("测试商品存在无效库存、售价或成本")
        if p["trackSerial"] and p["quantity"] != len(p["serials"]):
            raise ValueError("串码数量与库存数量不一致")
    serialized = [p for p in products if p["trackSerial"]]
    accessories = [p for p in products if not p["trackSerial"]]
    summary = {
        "serialRowsInSource": len(serial_rows),
        "serialRowsAccepted": sum(len(p["serials"]) for p in serialized),
        "serializedProducts": len(serialized),
        "accessoryProducts": len(accessories),
        "accessoryUnits": sum(p["quantity"] for p in accessories),
        "generatedTestPrices": sum(p["testPriceGenerated"] for p in products),
        "skippedSerialRows": dict(skipped),
    }
    payload = {"batchId": "test-stock-2026-10-07", "testData": True,
        "sources": [catalog_path.name, serial_path.name, stock_path.name],
        "summary": summary, "products": products}
    payload["contentHash"] = hashlib.sha256(json.dumps(products, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    return payload


def main():
    if len(sys.argv) != 5:
        raise SystemExit(__doc__)
    inputs = [Path(x) for x in sys.argv[1:4]]
    output = Path(sys.argv[4])
    payload = build(*inputs)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()