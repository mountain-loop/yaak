import {
	useAtomValue
} from 'jotai';
import { graphqlSchemaAtom } from "../atoms/graphqlSchemaAtom";
import { Input } from "./core/Input";
import type {
	GraphQLSchema,
	GraphQLOutputType,
	GraphQLScalarType,
	GraphQLField,
	GraphQLList,
	GraphQLArgument,
	GraphQLInputType,
	GraphQLNonNull
} from "graphql";
import { isNonNullType, isListType } from "graphql";
import { Button } from "./core/Button";
import { useState } from 'react';
import { IconButton } from "./core/IconButton";

function getRootTypes(graphqlSchema: GraphQLSchema) {
	return ([
		graphqlSchema.getQueryType(),
		graphqlSchema.getMutationType(),
		graphqlSchema.getSubscriptionType(),
	]
		.filter(Boolean) as NonNullable<ReturnType<GraphQLSchema['getQueryType']>>[])
		.reduce(
			(
				prev,
				curr
			) => {
				return {
					...prev,
					[curr.name]: curr,
				};
			},
			{} as Record<string, NonNullable<ReturnType<GraphQLSchema['getQueryType']>>>
		)
}

type Field = NonNullable<ReturnType<GraphQLSchema['getQueryType']>>;
type FieldsMap = ReturnType<Field['getFields']>;

function DocsExplorer({
						  graphqlSchema
					  }: { graphqlSchema: GraphQLSchema }) {
	const rootTypes = getRootTypes(graphqlSchema);
	const [schemaPointer, setSchemaPointer] = useState<Field | GraphQLOutputType | GraphQLInputType | null>(null);
	const [history, setHistory] = useState<(Field | GraphQLInputType)[]>([]);

	const goBack = () => {
		if (history.length === 0) {
			return;
		}

		const newHistory = history.slice(0, history.length - 1);
		const newPointer = newHistory[newHistory.length - 1];
		setHistory(newHistory);
		setSchemaPointer(newPointer!);
	}

	const addToHistory = (pointer: Field | GraphQLInputType) => {
		setHistory([...history, pointer]);
	}

	const goHome = () => {
		setHistory([]);
		setSchemaPointer(null);
	}

	const renderRootTypes = () => {
		return (
			<div
				className="mt-5 flex flex-col gap-3"
			>
				{
					Object
						.values(rootTypes)
						.map(
							(x) => (
								<button
									key={ x.name }
									className="block text-primary cursor-pointer w-fit"
									onClick={
										() => {
											addToHistory(x);
											setSchemaPointer(x);
										}
									}
								>
									{ x.name }
								</button>
							)
						)
				}
			</div>
		);
	}

	const onTypeClick = (
		type: GraphQLField<never, never>['type']
	) => {
		console.log(type);
		// check if non-null
		if (isNonNullType(type)) {
			onTypeClick((type as GraphQLNonNull<GraphQLOutputType>).ofType)

			return;
		}

		// check if list
		if (isListType(type)) {
			onTypeClick((type as GraphQLList<GraphQLOutputType>).ofType);

			return;
		}

		setSchemaPointer(type);
		addToHistory(type as Field);
	};

	const onArgumentClick = (
		arg: GraphQLArgument
	) => {
		// extract type of argument
		const type = isNonNullType(arg.type) ? arg.type.ofType : arg.type;

		if (isListType(type)) {
			setSchemaPointer((type as GraphQLList<GraphQLInputType>).ofType);
			addToHistory(type.ofType);
			return;
		}

		setSchemaPointer(type);
		addToHistory(type);
	};

	const renderSubFieldRecord = (
		field: FieldsMap[string]
	) => {
		return (
			<div
				className="flex flex-row justify-start items-center"
			>
				<IconButton size="sm" icon="plus_circle" iconColor="secondary" title="Add to query"/>
				<div
					className="flex flex-col"
				>
					<div>
					<span>
						{ " " }
					</span>
						<span
							className="text-primary"
						>
						{ field.name }
					</span>
						{/* Arguments block */ }
						{
							field.args && field.args.length > 0
								? (
									<>
								<span>
									{ " " }
									(
									{ " " }
								</span>
										{
											field.args.map(
												(arg, i, array) => (
													<>
														<button
															key={ arg.name }
															onClick={ () => onArgumentClick(arg) }
														>
															<span
																className="text-primary cursor-pointer"
															>
																{ arg.name }
															</span>
																	<span>{ " " }</span>
																	<span
																		className="text-success underline cursor-pointer"
																	>{ arg.type.toString() }</span>
																	{
																		i < array.length - 1
																			? (
																				<>
																					<span>{ " " }</span>
																					<span> , </span>
																					<span>{ " " }</span>
																				</>
																			)
																			: null
																	}
														</button>
														<span>{ " " }</span>
													</>
												)
											)
										}
										<span>
									)
								</span>
									</>
								)
								: null
						}
						{/* End of Arguments Block */ }
						<span>{ " " }</span>
						<button
							className="text-success underline cursor-pointer"
							onClick={ () => onTypeClick(field.type) }
						>
							{ field.type.toString() }
						</button>
					</div>
					{
						field.description
							? (
								<div>
									{ field.description }
								</div>
							)
							: null
					}
				</div>
			</div>
		);
	};

	const renderScalarField = () => {
		const scalarField = schemaPointer as GraphQLScalarType;

		return (
			<div>
				{ scalarField.toConfig().description }
			</div>
		);
	};

	const renderSubFields = () => {
		if (!schemaPointer) {
			return null;
		}

		if (
			!(schemaPointer as Field).getFields
		) {
			// Scalar field
			return renderScalarField();
		}

		if (!schemaPointer.getFields()) {
			return null;
		}

		return Object.values(schemaPointer.getFields())
			.map(
				(x) => renderSubFieldRecord(x)
			)
	};

	const renderFieldDocView = () => {
		if (!schemaPointer) {
			return null;
		}

		return (
			<div>
				<div
					className="text-primary mt-4"
				>
					{ schemaPointer.name }
				</div>
				<div
					className="my-3"
				>
					Fields
				</div>
				<div
					className="flex flex-col gap-7"
				>
					{ renderSubFields() }
				</div>
			</div>
		)
	}

	const renderExplorerView = () => {
		if (history.length === 0) {
			return renderRootTypes();
		}

		return renderFieldDocView()
	};

	const renderTopBar = () => {
		return (
			<div
				className="flex flex-row gap-2"
			>
				<Button
					onClick={ goBack }
				>
					Back
				</Button>
				<IconButton
					onClick={ goHome }
					icon="house"
					title="Go to beginning"
				/>
			</div>
		);
	};

	return (
		<div
			className="overflow-y-auto"
		>
			<div
				className="min-h-8"
			>
				{
					history.length > 0
						? renderTopBar()
						: null
				}
			</div>
			<Input
				label="Search docs"
				stateKey="search_graphql_docs"
				placeholder="Search docs"
				hideLabel
			/>
			<div>
				{ renderExplorerView() }
			</div>
		</div>
	);
}

export function GraphQLDocsExplorer() {
	const graphqlSchema = useAtomValue(graphqlSchemaAtom);

	if (graphqlSchema) {
		return <DocsExplorer graphqlSchema={ graphqlSchema }/>;
	}

	return <div>There is no schema</div>;
}
