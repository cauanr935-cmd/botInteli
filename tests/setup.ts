// Segredo fixo só para os testes (R4: nenhum teste usa credencial real).
import { configurePessoaIdSecret } from "../src/lib/hash";
configurePessoaIdSecret("segredo-de-teste-pessoa-id-0123456789abcdef");
