import { getEvolutionState } from '@/lib/evolution-api';
import { estadoDoState, classificarFalhaSonda, type EstadoInstancia } from '@/lib/disparos-destinos';

/**
 * Estado real da instância agora — mora FORA de `disparos-destinos` de
 * propósito: aquela lib é consumida por client components (o modal de
 * confirmação usa `nomeConfere`), e importar o provider lá arrastaria
 * `evolution-api` inteiro pro bundle do navegador.
 *
 * ⚠️ Não usa `checkEvolutionStatus`, que devolve `false` tanto pra "instância
 * apagada" quanto pra "Evolution fora do ar" — indistinguíveis, essas duas
 * fariam soluço de rede pausar campanha saudável.
 */
export async function sondarInstancia(instanceId: string): Promise<EstadoInstancia> {
  try {
    const { state } = await getEvolutionState(instanceId);
    return estadoDoState(state);
  } catch (err) {
    return classificarFalhaSonda(err instanceof Error ? err.message : String(err));
  }
}
