#!/usr/bin/env python3
"""Converte o JSON dos scripts em texto legível para a leitura do Claude.
Datas em BRT com o dia da semana CALCULADO (nunca deduzido de cabeça)."""
import json, sys, os
from datetime import datetime, timedelta, timezone

BRT = timezone(timedelta(hours=-3))
DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

def quando(iso):
    if not iso:
        return '—'
    d = datetime.fromisoformat(str(iso).replace('Z', '+00:00')).astimezone(BRT)
    return f"{DIAS[d.weekday()]} {d:%d/%m %H:%M}"

def dia(iso):
    if not iso:
        return '—'
    d = datetime.fromisoformat(str(iso).replace('Z', '+00:00')).astimezone(BRT)
    return f"{DIAS[d.weekday()]} {d:%d/%m/%Y}"

def brl(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return '—'
    return 'R$ ' + f"{v:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.') if v else '—'

def linhas_msgs(msgs, marcar_novo=False):
    out = []
    for m in msgs:
        quem = 'CLIENTE' if m['d'] == 'in' else ('LOJA' + (f" ({m['autor']})" if m.get('autor') else ''))
        t = ' '.join(str(m.get('t') or '').split()) or '[sem texto]'
        novo = ' ★NOVA' if marcar_novo and m.get('novo') else ''
        out.append(f"  [{quando(m['em'])}] {quem}{novo}: {t}")
    return out

def pull(arq, dest, cid, por_parte=30):
    j = json.load(open(arq))
    funis = {}
    for s in j['stages']:
        funis.setdefault(s['funnel_id'], []).append(s['label'])
    cab = ['ETAPAS DO FUNIL (use o nome EXATO):']
    for f, labels in funis.items():
        cab.append(f"  funil {f[:8]}: " + ' → '.join(labels))
    leads = j['leads']
    man = {'pulled_at': j['pulled_at'], 'leads': [
        {'id': l['id'], 'status': l['status'], 'temperatura': l['temperatura'], 'ultima_msg': l['ultima_msg']} for l in leads]}
    json.dump(man, open(os.path.join(dest, f'{cid}-manifesto.json'), 'w'))
    partes = 0
    for i in range(0, len(leads), por_parte):
        partes += 1
        txt = list(cab) + ['']
        for l in leads[i:i + por_parte]:
            fun = (l.get('funnel_id') or '')[:8]
            txt.append(f"=== LEAD {l['id']} · {l.get('nome') or 'sem nome'} · canal: {l.get('canal') or '—'} · funil {fun}")
            txt.append(f"    etapa atual: {l.get('status') or '—'} · temperatura: {l.get('temperatura') or '—'} · valor do negócio: {brl(l.get('valor_negocio'))} · venda: {brl(l.get('valor_rs'))}"
                       f"{' · PERDIDO (' + l['motivo_perda'] + ')' if l.get('motivo_perda') else ''} · lead criado {dia(l.get('created_at'))}")
            if l.get('observacao'):
                txt.append(f"    obs: {' '.join(l['observacao'].split())}")
            txt.extend(linhas_msgs(l['mensagens'], True))
            txt.append('')
        open(os.path.join(dest, f'{cid}-parte-{partes}.txt'), 'w').write('\n'.join(txt))
    print(f"{len(leads)} conversas com mensagem nova em {partes} parte(s): " +
          ', '.join(os.path.join(dest, f'{cid}-parte-{n}.txt') for n in range(1, partes + 1)))

def notas(arq, dest, cid, por_parte=25):
    j = json.load(open(arq))
    leads = j['leads']
    partes = 0
    for i in range(0, len(leads), por_parte):
        partes += 1
        txt = []
        for l in leads[i:i + por_parte]:
            ant = f" · nota anterior {l['nota_anterior']}/5" if l.get('nota_anterior') is not None else ''
            txt.append(f"=== LEAD {l['id']} · {l.get('nome') or 'sem nome'} · canal: {l.get('canal') or '—'} · etapa: {l.get('status') or '—'} · criado {dia(l.get('created_at'))}{ant}")
            for m in l['mensagens']:
                quem = 'CLIENTE' if m['d'] == 'in' else ('LOJA' + (f" ({m['autor']})" if m.get('autor') else ''))
                t = ' '.join(str(m.get('t') or '').split()) or '[sem texto]'
                txt.append(f"  #{m['n']} [{quando(m['em'])}] {quem}: {t}")
            txt.append('')
        open(os.path.join(dest, f'{cid}-notas-parte-{partes}.txt'), 'w').write('\n'.join(txt))
    print(f"{len(leads)} conversas para dar nota em {partes} parte(s): " +
          ', '.join(os.path.join(dest, f'{cid}-notas-parte-{n}.txt') for n in range(1, partes + 1)))

def metricas(arq, dest, cid):
    j = json.load(open(arq))
    p = os.path.join(dest, f'{cid}-metricas.txt')
    hist = j.get('auditoria_anterior')
    linhas = [f"CLIENTE: {j['cliente']} ({cid}) · gerado {quando(j['gerado_em'])}",
              f"Histórico de mensagens no sistema desde: {dia(j['historico_no_sistema_desde'])}"]
    if j.get('avaliacao_desde'):
        linhas.append(f"AVALIAÇÃO SÓ A PARTIR DE {j['avaliacao_desde']}: antes disso o atendimento era feito em outro WhatsApp; nada anterior entra nas métricas nem na amostra. Diga isso no resumo e NÃO compare com a auditoria anterior se ela cobria o período antigo.")
    linhas.append('')
    for k in ['ultimos_30_dias', 'ultimos_7_dias', 'semana_anterior', 'captura_e_fila', 'tentativas_contato_30d']:
        linhas.append(k.upper() + ': ' + json.dumps(j[k], ensure_ascii=False))
    linhas.append('CANAIS 30D: ' + json.dumps(j['canais_30d'], ensure_ascii=False))
    linhas.append('ETAPAS DOS LEADS ATIVOS 30D: ' + json.dumps(j['etapas_dos_leads_ativos_30d'], ensure_ascii=False))
    linhas.append('AUTORES REGISTRADOS 30D: ' + json.dumps(j['autores_registrados_30d'], ensure_ascii=False))
    if hist:
        linhas.append(f"AUDITORIA ANTERIOR ({quando(hist['created_at'])}): nota {hist['nota_geral']} {hist['classificacao']} · critérios {json.dumps(hist['criterios'], ensure_ascii=False)}")
        linhas.append('  problemas apontados: ' + json.dumps(hist.get('problemas') or [], ensure_ascii=False))
    open(p, 'w').write('\n'.join(linhas))
    print(p)

def amostra(arq, dest, cid):
    j = json.load(open(arq))
    p = os.path.join(dest, f'{cid}-amostra.txt')
    txt = [f"{j['conversas_ativas_7d']} conversas com mensagem nos últimos 7 dias; amostra de {len(j['amostra'])}.", '']
    for c in j['amostra']:
        txt.append(f"=== LEAD {c['id']} · {c.get('nome') or 'sem nome'} · canal: {c.get('canal') or '—'} · etapa: {c.get('status') or '—'} · temp: {c.get('temperatura') or '—'} · por que entrou: {c['motivo']} · criado {dia(c.get('criado_em'))}")
        txt.extend(linhas_msgs(c['mensagens']))
        txt.append('')
    open(p, 'w').write('\n'.join(txt))
    print(f"{p} ({len(j['amostra'])} conversas)")

if __name__ == '__main__':
    modo, arq, dest, cid = sys.argv[1:5]
    {'pull': pull, 'notas': notas, 'metricas': metricas, 'amostra': amostra}[modo](arq, dest, cid)
