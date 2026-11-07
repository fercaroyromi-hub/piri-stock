# Genera feed.csv (formato de catálogo de Meta / WhatsApp) a partir de ml.json
import json, csv
d = json.load(open('ml.json'))
base = 'https://fercaroyromi-hub.github.io/piri-stock/catalogo.html?p='
with open('feed.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['id','title','description','availability','condition','price','link','image_link','additional_image_link','brand','item_group_id','product_type'])
    for x in d['items']:
        t = x['nombre'] + (' · ' + x['color'] if x['color'] else '')
        desc = f"{x['nombre']}{(' - ' + x['color']) if x['color'] else ''}. Personalizado con grabado láser por Pirí Diseño Láser. Pedilo por WhatsApp."
        w.writerow([x['id'], t[:150], desc, 'in stock' if x.get('stock', 1) > 0 else 'available for order', 'new',
                    f"{x['precio']:.2f} UYU", base + x['id'], x['fotos'][0], ','.join(x['fotos'][1:]), 'Pirí Diseño Láser',
                    x['cat'] + '|' + x['nombre'], x['cat']])
print('ok', len(d['items']))
