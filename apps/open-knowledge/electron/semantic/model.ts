/** Pinned model assets: downloads happen during development/build, never during a search. */
export const semanticModel = {
	id: 'multilingual-MiniLM-L12-v2-q8-v1',
	repository: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
	revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900',
	dimensions: 384,
	windowTokens: 126,
	windowStride: 96,
	minimumScore: 0.35,
	maximumScoreDrop: 0.2,
	files: [
		{
			name: 'model_quantized.onnx',
			remote: 'onnx/model_quantized.onnx',
			sha256: '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc'
		},
		{
			name: 'tokenizer.json',
			remote: 'tokenizer.json',
			sha256: 'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441'
		},
		{
			name: 'tokenizer_config.json',
			remote: 'tokenizer_config.json',
			sha256: '3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2'
		}
	]
} as const
