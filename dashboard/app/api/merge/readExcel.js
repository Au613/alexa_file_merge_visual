const XLSX = require("xlsx")
const fs = require("fs")
const path = require("path")
const {start} = require("repl")

/**
 * Converts an Excel serial number to JS Date.
 *      (44897.225069444445 -> 2022-12-02T05:24:06.000Z)
 * @param {number} serial
 * @returns {Date}
 */
function excelDateToJSDate(serial) {
	const utcDays = Math.floor(serial - 25569)
	const utcValue = utcDays * 86400
	const fractionalDay = serial - Math.floor(serial) + 0.0000001
	const totalSeconds = Math.floor(86400 * fractionalDay)
	return new Date((utcValue + totalSeconds) * 1000)
}
/**
 * Converts date string to date
 *      12/18/2022 14:57:13Z -> 2022-12-18T14:57:13.000Z
 * @param {string} string
 * @returns {Date}
 */
function stringToDate(dateString) {
	return new Date(dateString + "Z")
}

/**
 * Formats an ISO date string to MM/DD/YYYY H:mm:ss (using UTC) without leading zero for hours.
 *      2022-12-02T05:24:06.000Z --> 12/02/2022 5:24:06
 * @param {string} isoDate - The ISO 8601 date string (e.g., '2022-12-02T05:23:54.000Z').
 * @returns {string} - The formatted date string (e.g., '12/02/2022 5:23:54').
 */
function formatIsoDate(isoDate) {
	const date = new Date(isoDate)

	const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
	const dd = String(date.getUTCDate()).padStart(2, "0")
	const yyyy = date.getUTCFullYear()
	const hh = date.getUTCHours() // No leading zero for hours
	const min = String(date.getUTCMinutes()).padStart(2, "0")
	const sec = String(date.getUTCSeconds()).padStart(2, "0")

	return `${mm}/${dd}/${yyyy} ${hh}:${min}:${sec}`
}

/**
 * Reads an .xls file and returns its contents as an array of objects.
 * @param {string} filePath - The path to the .xls file.
 * @returns {Array<Object>} Parsed data from the first sheet.
 */
function readXlsToJson(filePath) {
	if (!fs.existsSync(filePath)) {
		throw new Error(`File does not exist: ${filePath}`)
	}

	const workbook = XLSX.readFile(filePath)
	const sheetNames = workbook.SheetNames

	if (sheetNames.length === 0) {
		throw new Error("No sheets found in the Excel file.")
	}

	const firstSheet = workbook.Sheets[sheetNames[0]]
	const data = XLSX.utils.sheet_to_json(firstSheet, {header: 1, defval: null})
	const formatted = data.map(([author, datetime, content]) => ({
		author,
		datetime: formatIsoDate(excelDateToJSDate(datetime)),
		data: content,
	}))

	return formatted
}

/**
 *
 * @param {*} filePath
 * @returns two objects: the focal follow objects
 */
function getFilePartitions(filePath) {
	const file_json = readXlsToJson(filePath) //array of objects
	let focalFollow_partitions = helper_findPartitions_from_F_to_END(filePath, file_json)

	//the first five lines are always the starting partition
	const startPartition = {
		startDateTime: file_json[0].datetime,
		startIndex: 0,
		endIndex: 4,
		endDateTime: file_json[4].datetime,
		filePath,
	}
	const initialComments = helper_comments_afterStartAndBeforeFirstPartition(focalFollow_partitions, filePath, file_json) //sometimes there are comments before focal follow
	const comments_after_last_follow = helper_getCommentsAfterEnd_partitions(filePath, file_json, focalFollow_partitions) // comments after the last follow
	const {notIncluded, gapPartitions} = helper_findGapComments(focalFollow_partitions, file_json, filePath)
	const all_nonFFComents = [...initialComments, ...comments_after_last_follow, ...gapPartitions]
	return {startPartition, focalFollow_partitions, all_nonFFComents}
}

function helper_findPartitions_from_F_to_END(inputFilePath, file_json) {
	const elements_with_focal_start = file_json.map((item, index) => ({item, index})).filter(({item}) => item.data && item.data.startsWith("F:"))

	const elements_with_focal_end = file_json.map((item, index) => ({item, index})).filter(({item}) => item.data && item.data.toLowerCase().startsWith("end"))

	let prev_start = null
	let prev_end = null

	const focalFollow_partitions = []

	let endIndexPointer = 0 // Pointer to keep track of the end elements

	// Iterate over the focal start elements
	for (let i = 0; i < elements_with_focal_start.length; i++) {
		const start = elements_with_focal_start[i]

		// If the current start is before the previous end, skip this start
		if (prev_end !== null && start.index < prev_end) {
			continue
		}

		// Move the end pointer until we find an end after the current start
		while (endIndexPointer < elements_with_focal_end.length) {
			const end = elements_with_focal_end[endIndexPointer]

			// If the current end is less than the current start, move to the next end
			if (end.index < start.index) {
				endIndexPointer++
				continue
			}

			// If we've found a valid end after the start
			focalFollow_partitions.push({
				startIndex: start.index,
				startDateTime: start.item.datetime,
				endIndex: end.index,
				endDateTime: end.item.datetime,
				filePath: inputFilePath,
			})

			// Update prev_start and prev_end for the next iteration
			prev_start = start.index
			prev_end = end.index

			// Move to the next end and break out of the while loop
			endIndexPointer++
			break
		}
	}
	return focalFollow_partitions
}

function helper_comments_afterStartAndBeforeFirstPartition(focalFollow_partitions, inputFilePath, file_json) {
	if (focalFollow_partitions.length > 0) {
		const firstElement = focalFollow_partitions[0]
		const newStartIndex = 5
		const newEndIndex = firstElement.startIndex - 1
		let partitionRows = file_json
			.slice(newStartIndex, newEndIndex)
			.map((row, index) => ({
				index: newStartIndex + index,
				row,
				inputFilePath,
			}))
			.filter((entry) => entry.row.data.startsWith("C"))
		partitionRows = partitionRows.filter((el) => el !== undefined)
		return partitionRows
	}
	return []
}

function helper_getCommentsAfterEnd_partitions(filePath, file_json, focalFollow_partitions) {
	const numPartitions = focalFollow_partitions.length
	let after_comments = []
	if (numPartitions > 0) {
		const lastPartition_endIndex = focalFollow_partitions[focalFollow_partitions.length - 1].endIndex + 1
		if (file_json.length > lastPartition_endIndex) {
			after_comments = file_json
				.map((row, index) => {
					if (row === undefined || row.data === null || row.data === undefined || row.data === "") return null
					try {
						if (index >= lastPartition_endIndex && row.data.startsWith("C")) {
							return {index, filePath, datetime: row.datetime, row}
						} else {
							return null
						}
					} catch (e) {
						console.log(e)
					}
					return null
				})
				.filter((el) => el !== null)
		}
	} else {
		after_comments = file_json.map((row, index) => (row.data.startsWith("C") ? {index, filePath, datetime: row.datetime, row} : null)).filter((el) => el !== null)
	}

	return after_comments
}

function helper_findGaps(focalFollow_partitions) {
	const gaps = []
	for (let i = 0; i < focalFollow_partitions.length - 1; i++) {
		const currentEndIndex = focalFollow_partitions[i].endIndex
		const nextStartIndex = focalFollow_partitions[i + 1].startIndex

		if (nextStartIndex > currentEndIndex + 1) {
			gaps.push({
				previousPartitionEndIndex: currentEndIndex,
				nextPartitionStartIndex: nextStartIndex,
				gapSize: nextStartIndex - currentEndIndex - 1,
			})
		}
	}
	return gaps
}

function helper_findGapComments(focalFollow_partitions, file_json, filePath) {
	const gaps = helper_findGaps(focalFollow_partitions)
	let gapPartitions = []
	let notIncluded = []

	gaps.forEach((gap) => {
		const {previousPartitionEndIndex, nextPartitionStartIndex} = gap
		const gapRows = file_json.slice(previousPartitionEndIndex + 1, nextPartitionStartIndex)

		for (let i = 0; i < gapRows.length; i++) {
			const row = gapRows[i]
			const actualIndex = previousPartitionEndIndex + 1 + i
			// ADD A LINE TO CHECK TO SEE IF THE LINE STARTS WITH A C: OR NOT
			if (row.data.startsWith("C")) {
				gapPartitions.push({index: actualIndex, filePath, time: row.datetime, row})
			} else {
				notIncluded.push({index: actualIndex, filePath, time: row.datetime, row})
			}
		}
	})

	return {notIncluded, gapPartitions}
}

//______________________________________________________________________________

function helper_findGap_partitions(filesByDate, inputFolderPath) {
	let allJSON_Partitions = {}
	let allJSON_Starting = {}
	let allJSON_nonPartition_comments = {}
	for (const [date, files] of Object.entries(filesByDate)) {
		let all_extended_partitions = []
		let all_starting_partitions = []
		let nonPartition_comments = []
		files.forEach((file) => {
			const full_file_path = `${inputFolderPath}\\${file}`
			const {startPartition, focalFollow_partitions, all_nonFFComents} = getFilePartitions(full_file_path)
			all_extended_partitions.push(...focalFollow_partitions)
			all_starting_partitions.push(startPartition)
			nonPartition_comments.push(...all_nonFFComents)
		})

		allJSON_Partitions[date] = all_extended_partitions
		allJSON_Starting[date] = all_starting_partitions
		allJSON_nonPartition_comments[date] = nonPartition_comments
	}
	return {allJSON_Partitions, allJSON_Starting, allJSON_nonPartition_comments}
}

function groupFilesByDate(folder_files) {
	const partitions = {}
	folder_files.forEach((file) => {
		const match = file.match(/^(\d{4}\.\d{2}\.\d{2})/)
		if (match) {
			const date = match[1]
			if (!partitions[date]) {
				partitions[date] = []
			}
			partitions[date].push(file)
		}
	})
	return partitions
	//For each file
}

function helper_getAllRelativeFilePaths(inputFolderPath) {
	const absolutePath = path.resolve(inputFolderPath)
	const files = fs.readdirSync(absolutePath)
	return files
}

function helper_extractUniqueDates(filenames) {
	const dateSet = new Set()

	filenames.forEach((filename) => {
		const match = filename.match(/^(\d{4}\.\d{2}\.\d{2})/)
		if (match) {
			dateSet.add(match[1])
		}
	})

	return Array.from(dateSet)
}

function sortArrays(allJSON_Partitions, allJSON_Starting) {
	let sortedJSON_partitions = {}
	for (const [date, partitions_array] of Object.entries(allJSON_Partitions)) {
		const sorted_partitions = sortByStartDateTime(partitions_array)
		sortedJSON_partitions[date] = sorted_partitions
	}
	let sortedJSON_start_partitions = {}
	for (const [date, partitions_array] of Object.entries(allJSON_Starting)) {
		const sorted_partitions = sortByStartDateTime(partitions_array)
		sortedJSON_start_partitions[date] = sorted_partitions
	}
	return {sortedJSON_partitions, sortedJSON_start_partitions}
}

function helper_adjustPartitionArrayTimes(arr, date) {
	let prevPartition = null
	let newPartitions = []
	for (partition of arr) {
		if (prevPartition === null) {
			prevPartition = partition
			newPartitions.push(partition)
			continue
		} else {
			const fiveMinutes = 310000 // 5000 (ms) * 60 sec per min
			const prev_end = stringToDate(prevPartition.endDateTime)
			const current_start = stringToDate(partition.startDateTime)
			const timeDiff = getTimeDiff(prev_end, current_start)
			const timeAdjustment = 1000
			const totalTimeAdjustment = -timeDiff + timeAdjustment
			// 1 - 1:30
			// 1:20 - 2

			// diff is - 10000

			// 1 - 1:30
			// 1:40 - 2

			// diff is 100000

			// second - first > 5
			// if (date === "2022.12.01") console.log(timeDiff > fiveMinutes, prevPartition.endDateTime, partition.startDateTime)
			if (timeDiff > fiveMinutes) {
				newPartitions.push(partition)
			} // only adjust if the time difference is due to machine differences #FIX THIS IN THE CASE OF PAST MORE THAN 5 min
			else {
				const newStartDateTime = formatIsoDate(new Date(current_start.getTime() + totalTimeAdjustment))
				const newEndDateTime = formatIsoDate(new Date(stringToDate(partition.endDateTime).getTime() + totalTimeAdjustment))

				const adjustedPartition = {
					...partition,
					startDateTime: newStartDateTime,
					endDateTime: newEndDateTime,
					adjustment: totalTimeAdjustment,
				}
				newPartitions.push(adjustedPartition)
			}
			prevPartition = partition
		}
	}
	return newPartitions
}

function adjustTime_JSON(allJSON_Partitions) {
	let adjustedPartitions = {}
	for (let [date, partitions] of Object.entries(allJSON_Partitions)) {
		const adjus = helper_adjustPartitionArrayTimes(partitions, date)
		adjustedPartitions[date] = adjus
	}

	return adjustedPartitions
}

function makeOneContinuousFocalFollow(data) {
	const dataCol = 2
	let F_starts = []
	let focals = []
	let ends = []
	let losts = []
	let previousLine
	let previousIndex
	data.forEach((row, index) => {
		try {
			if (row[dataCol].trim() === "") return
			if (row[dataCol].startsWith("F:")) {
				F_starts.push({[index]: row})
				focals.push(row[dataCol].split("F: "))
			} else if (row[dataCol].toLowerCase().startsWith("end")) {
				ends.push({[index]: row})
			} else if (row[dataCol].toLowerCase().startsWith("c lost focal")) {
				losts.push({[index]: row})
			}
			previousLine = row
			previousIndex = index
		} catch (e) {
			console.log(previousIndex, previousLine)
			console.log(index, row)
		}
	})

	const startSplits = splitByKeys(F_starts, losts)
	const endSplits = splitByKeys(ends, losts)

	const removeStarts = startSplits.map((innerArray) => innerArray.slice(1).map((obj) => Object.keys(obj)[0]))
	const removeEnds = endSplits.map((innerArray) => innerArray.slice(0, -1).map((obj) => Object.keys(obj)[0]))
	const removeRowIndexes = [...removeStarts.flat(), ...removeEnds.flat()].map((el) => parseInt(el))
	let continuousFocalFollowData = data.filter((obj, index) => {
		return !removeRowIndexes.includes(index)
	})
	return continuousFocalFollowData
}

function fixRowLine(currentRowIndex, combinedData) {
    // Ensure the current row index is valid and there is a previous row
    if (currentRowIndex <= 0 || currentRowIndex >= combinedData.length) {
        return combinedData[currentRowIndex]; // Return the original row if out of bounds
    }

    let previousRow = combinedData[currentRowIndex - 1];
    let currentRow = combinedData[currentRowIndex];
    let data = 2; // Assuming the relevant data is in column 2

    // Check the HF issue
    if (/^HC[A-Z]{5}/.test(currentRow[data])) {
        // Check if the previous row has a singular character after the first four characters and a space
        if (!/^.{4} [A-Z] /.test(previousRow[data])) {
            currentRow[data] = `Corrected: ${currentRow[data]}`; // Example correction
        }
    }

    // Check the missing monkey issue
    if (/^XX./.test(currentRow[data])) {
        // Replace the third character with "F"
        currentRow[data] = currentRow[data].replace(/^XX./, "XFF");
    }

    return currentRow; // Always return the corrected or original row
}

function splitByKeys(mainArray, dividerKeys) {
	const sortedDividers = dividerKeys.map((obj) => Object.keys(obj)[0]).sort((a, b) => Number(a) - Number(b))
	const sortedMain = mainArray.sort((a, b) => Number(Object.keys(a)[0]) - Number(Object.keys(b)[0]))

	const result = []
	let currentGroup = []
	let dividerIndex = 0

	for (const item of sortedMain) {
		const key = Object.keys(item)[0]

		// If current key is beyond the next divider, push the current group and reset
		while (dividerIndex < sortedDividers.length && Number(key) >= Number(sortedDividers[dividerIndex])) {
			result.push(currentGroup)
			currentGroup = []
			dividerIndex++
		}

		currentGroup.push(item)
	}

	if (currentGroup.length > 0) {
		result.push(currentGroup)
	}

	return result
}
//check data for mistakes
function correctMistakes(lines) {
    for (let i = 1; i < lines.length; i++) {
        const firstLine = lines[i - 1];
        const secondLine = lines[i];

        // Check if the third column of the second line starts with "HC"
        if (/^HC/.test(secondLine[2])) {
            // Extract the first letter after "HC" in the third column of the second line
            const match = secondLine[2].match(/^HC\s*([A-Z])/);
            if (match) {
                const letterAfterHC = match[1];

                // Check if the third column of the first line contains a singular letter repeated only once or multiple times
                if (!/\b[A-Z]\b/.test(firstLine[2])) {
                    // Insert the letter into the third column of the first line between the first word and the rest
                    const updatedFirstLine = firstLine[2].replace(/^(\S+)(.*)$/, `$1 ${letterAfterHC}$2`);
                    firstLine[2] = updatedFirstLine; // Update the third column of the first line
                }
            }
        }

        // Check if the third column of a line doesn't start with "X" and the 4th and 5th letters are "X"
        if (!/^X/.test(secondLine[2]) && secondLine[2][3] === "X" && secondLine[2][4] === "X") {
            // Replace the 5th letter with the same letter as the 6th letter
            const updatedSecondLine = secondLine[2].substring(0, 4) + secondLine[2][5] + secondLine[2].substring(5);
            secondLine[2] = updatedSecondLine; // Update the third column of the second line
        }
    }

    return lines;
}

/**
 *
 * @param {arr[obj]} datePartiton_array this is an array of partition objects
 * writes the final merged files
 */
function writeFile_helper(date, datePartiton_array, extra_comments, outputDir) {
	const files = datePartiton_array.map((el) => el.filePath)
	const filePaths = new Set(files)

	const fileData_json = {}
	for (let filePath of filePaths) {
		const workbook = XLSX.readFile(filePath)
		const sheetName = workbook.SheetNames[0]
		const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header: 1})
		fileData_json[filePath] = sheet
	}
	let combinedData = []
	datePartiton_array.forEach((partition) => {
		let {startIndex, endIndex, filePath} = partition
		let extractedData = fileData_json[filePath].slice(startIndex, endIndex + 1) // check to see about off by 1 errors
		combinedData.push(...extractedData)
	})
	combinedData = combinedData.map((el) => {
		const boop = [el[0], formatIsoDate(excelDateToJSDate(el[1])), el[2]] // could be made better
		return boop
	})
	//add in comments
	const commentsRows = extra_comments
		.filter((entry) => entry.length === undefined)
		.map((entry) => {
			return [entry.row.author, entry.row.datetime, entry.row.data]
		})
	combinedData = [...combinedData, ...commentsRows]
	combinedData = sortByStartDateTimeComments(combinedData)
	combinedData = makeOneContinuousFocalFollow(combinedData)

	combinedData = correctMistakes(combinedData)

	//______________________________________________________
	let newWorkbook = XLSX.utils.book_new()
	let newSheet = XLSX.utils.aoa_to_sheet(combinedData)
	XLSX.utils.book_append_sheet(newWorkbook, newSheet, "Sheet1")

	const outputDir_path = path.join(__dirname, "merged_files")
	if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir_path)
	let outputFilePath = path.join(outputDir_path, `${date}.xls`)
	try {
		XLSX.writeFile(newWorkbook, outputFilePath)
	} catch (e) {
		console.log(" Unable to write the file for " + date)
	}
}

function partitionsToFile(sortedJSON_partitions, sortedJSON_start_partitions, allJSON_nonPartition_comments, outputDir) {
	for (let date of Object.keys(sortedJSON_partitions)) {
		const datePartiton_array = [sortedJSON_start_partitions[date][0], ...sortedJSON_partitions[date]]
		const extra_comments = allJSON_nonPartition_comments[date]
		writeFile_helper(date, datePartiton_array, extra_comments, outputDir)
		console.log("writing file" + date)
	}
}

function master(inputFolderPath, outputDir) {
	const folder_files = helper_getAllRelativeFilePaths(inputFolderPath)
	const filesByDate = groupFilesByDate(folder_files)

	const {allJSON_Partitions, allJSON_Starting, allJSON_nonPartition_comments} = helper_findGap_partitions(filesByDate, inputFolderPath)
	const {sortedJSON_partitions, sortedJSON_start_partitions} = sortArrays(allJSON_Partitions, allJSON_Starting)
	const adjustedJSON_partitions = adjustTime_JSON(sortedJSON_partitions)
	partitionsToFile(adjustedJSON_partitions, sortedJSON_start_partitions, allJSON_nonPartition_comments, outputDir)
}

function sortByStartDateTime(arr) {
	return arr.sort((a, b) => {
		const dateA = new Date(a["startDateTime"])
		const dateB = new Date(b["startDateTime"])
		return dateA - dateB
	})
}

function sortByStartDateTimeComments(arr) {
	return arr.sort((a, b) => {
		const dateA = new Date(a[1])
		const dateB = new Date(b[1])
		return dateA - dateB
	})
}

function getTimeDiff(dateString1, dateString2) {
	const date1 = new Date(dateString1)
	const date2 = new Date(dateString2)
	return date2 - date1
}

// Example usage of process FILE
const inputFilePath = path.resolve(__dirname, "ALD Team Files/merge_queue/2022.12.02.rf.mad.xE.xls") // Replace with your file path
// const OG_json = getFilePartitions(inputFilePath)
// console.log(OG_json)

const inputFolderPath = path.resolve(__dirname, "ALD Team Files/merge_queue/") // Replace with your file path
const outputDir = "merged_files"
master(inputFolderPath, outputDir)

const outputPath = path.resolve(__dirname, "output.xls")
