import { Injectable } from '@nestjs/common';

/** Stand-in for the JWKS verifier. Only the spike's fixed token is valid. */
@Injectable()
export class TokenVerifier {
  static readonly spikeToken = 'spike-token';

  verify(token: string): { sub: string } | null {
    return token === TokenVerifier.spikeToken ? { sub: 'user-1' } : null;
  }
}
