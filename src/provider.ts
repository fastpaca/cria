import type { z } from "zod";
import type {
  CacheDescriptor,
  MaybePromise,
  PromptLayout,
  PromptMessage,
  ProviderToolIO,
} from "./types";

/**
 * Context passed into codec rendering.
 *
 * This is derived from the fitted prompt tree and allows providers/adapters to
 * map provider-agnostic hints (like cache pinning) to provider-native features
 * during render.
 */
export interface ProviderRenderContext {
  cache?: CacheDescriptor | undefined;
}

/**
 * Bidirectional codec between PromptLayout (IR) and provider-native input.
 */
export abstract class MessageCodec<TRendered, TToolIO extends ProviderToolIO> {
  abstract render(layout: PromptLayout<TToolIO>): TRendered;
  abstract parse(rendered: TRendered): PromptLayout<TToolIO>;
}

/**
 * List-based codec that maps message-by-message between IR and provider input.
 * Providers with non-standard structures can override render/parse directly.
 */
export abstract class ListMessageCodec<
  TProviderMessage,
  TToolIO extends ProviderToolIO,
> extends MessageCodec<readonly TProviderMessage[], TToolIO> {
  protected abstract toProviderMessage(args: {
    message: PromptMessage<TToolIO>;
    index: number;
  }): readonly TProviderMessage[];
  protected abstract fromProviderMessage(
    message: TProviderMessage
  ): readonly PromptMessage<TToolIO>[];

  override render(layout: PromptLayout<TToolIO>): readonly TProviderMessage[] {
    return layout.flatMap((message, index) =>
      this.toProviderMessage({ message, index })
    );
  }

  override parse(rendered: readonly TProviderMessage[]): PromptLayout<TToolIO> {
    return rendered.flatMap((message) => this.fromProviderMessage(message));
  }
}

/**
 * Provider interface for rendering and execution.
 *
 * - TRendered is the provider-specific payload shape returned by the codec.
 * - TToolIO anchors tool-call input/output types for the entire pipeline.
 *
 * This is where provider-specific types are introduced and then threaded
 * through the prompt tree, layout, and codecs.
 */
export abstract class ModelProvider<
  TRendered,
  TToolIO extends ProviderToolIO = ProviderToolIO,
> {
  /** Codec that translates between PromptLayout and provider-native input. */
  abstract readonly codec: MessageCodec<TRendered, TToolIO>;

  /** Count tokens for rendered output (tiktoken-backed). */
  abstract countTokens(rendered: TRendered): number;

  /** Generate a text completion from rendered prompt input. */
  abstract completion(rendered: TRendered): MaybePromise<string>;

  /**
   * Generate a structured object validated against the schema.
   *
   * Implementations should use native structured output when available
   * (e.g., AI SDK's generateObject, OpenAI's json_schema response_format),
   * falling back to completion + JSON.parse + schema.parse internally.
   */
  abstract object<T>(
    rendered: TRendered,
    schema: z.ZodType<T>
  ): MaybePromise<T>;
}

/**
 * Wrapper for PromptLayout inputs.
 */
export interface InputLayout<TToolIO extends ProviderToolIO = ProviderToolIO> {
  kind: "input-layout";
  value: PromptLayout<TToolIO>;
}

/**
 * Structural mapping between protocol input and provider input.
 *
 * Adapters must not change semantics (no merging/splitting). They only
 * reshape fields and content containers.
 */
export interface ProviderAdapter<TProtocolInput, TProviderInput> {
  /** Convert protocol input into the provider-native input shape. */
  to(input: TProtocolInput, context?: ProviderRenderContext): TProviderInput;
  /** Convert provider-native input into the protocol input shape. */
  from(input: TProviderInput): TProtocolInput;
}

/**
 * Compose a protocol codec with a provider adapter into a provider codec.
 */
export class CompositeCodec<
  TProviderInput,
  TProtocolInput,
  TToolIO extends ProviderToolIO,
> extends MessageCodec<TProviderInput, TToolIO> {
  private readonly protocol: MessageCodec<TProtocolInput, TToolIO>;
  private readonly adapter: ProviderAdapter<TProtocolInput, TProviderInput>;

  constructor(
    protocol: MessageCodec<TProtocolInput, TToolIO>,
    adapter: ProviderAdapter<TProtocolInput, TProviderInput>
  ) {
    super();
    this.protocol = protocol;
    this.adapter = adapter;
  }

  /** Render PromptLayout into provider input via protocol + adapter. */
  render(layout: PromptLayout<TToolIO>): TProviderInput;
  render(
    layout: PromptLayout<TToolIO>,
    context?: ProviderRenderContext
  ): TProviderInput {
    const protocolInput = this.protocol.render(layout);
    return this.adapter.to(protocolInput, context);
  }

  /** Parse provider input into PromptLayout via adapter + protocol. */
  parse(input: TProviderInput): PromptLayout<TToolIO> {
    return this.protocol.parse(this.adapter.from(input));
  }
}

/**
 * Base provider that binds protocol + adapter into a single codec.
 */
export abstract class ProtocolProvider<
  TProviderInput,
  TProtocolInput,
  TToolIO extends ProviderToolIO,
> extends ModelProvider<TProviderInput, TToolIO> {
  readonly codec: MessageCodec<TProviderInput, TToolIO>;

  /** Construct a protocol provider with a protocol codec and adapter. */
  protected constructor(
    protocol: MessageCodec<TProtocolInput, TToolIO>,
    adapter: ProviderAdapter<TProtocolInput, TProviderInput>
  ) {
    super();
    this.codec = new CompositeCodec(protocol, adapter);
  }
}
